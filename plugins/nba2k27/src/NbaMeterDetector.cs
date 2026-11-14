using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

/// <summary>CPU-only curved-meter geometry. Acquisition never consults a player, tag, court or neural model.</summary>
internal sealed class NbaMeterDetector(NbaMeterSettings settings)
{
    internal readonly record struct Measurement(VisionCrop Bounds, double Progress, double Score, double Height, double TargetX, double TargetY,
        double Bow = 0, double End = 0, double Thickness = 0);
    private bool[] _mask = [];
    private int[] _queue = [];
    private Measurement? _previous;
    private readonly record struct Cap(double X, double Y, double Width, int Area);
    internal void Reset() => _previous = null;

    internal Measurement? Detect(ReadOnlySpan<byte> pixels, int width, int height, int stride)
    {
        var search = _previous is { } last ? Expand(last.Bounds, .6) : settings.Viewport;
        var result = Search(pixels, width, height, stride, search);
        if (result is null && _previous is not null) result = Search(pixels, width, height, stride, settings.Viewport);
        _previous = result;
        return result;
    }
    private Measurement? Search(ReadOnlySpan<byte> pixels, int width, int height, int stride, VisionCrop search)
    {
        int step = Math.Max(1, height / 720);
        int left = (int)(search.Left * width), top = (int)(search.Top * height);
        int columns = Math.Max(1, (int)(search.Width * width) / step), rows = Math.Max(1, (int)(search.Height * height) / step);
        int count = checked(columns * rows);
        if (_mask.Length < count) { _mask = new bool[count]; _queue = new int[count]; }
        double targetHue = Hue(settings.TargetRed, settings.TargetGreen, settings.TargetBlue);
        for (int y = 0; y < rows; y++) for (int x = 0; x < columns; x++)
        {
            int i = (top + y * step) * stride + (left + x * step) * 4;
            int b = pixels[i], g = pixels[i+1], r = pixels[i+2], hi = Math.Max(r, Math.Max(g,b)), lo = Math.Min(r, Math.Min(g,b));
            double difference = Math.Abs(Hue(r,g,b)-targetHue); difference = Math.Min(difference,360-difference);
            _mask[y*columns+x] = hi >= 100 && hi-lo >= 40 && difference <= settings.ColorToleranceDegrees;
        }
        var caps = new List<Cap>(16);
        for (int start = 0; start < count; start++)
        {
            if (!_mask[start]) continue;
            int head=0, tail=1, minX=start%columns,maxX=minX,minY=start/columns,maxY=minY;
            double sumX=0,sumY=0; _queue[0]=start;_mask[start]=false;
            while(head<tail)
            {
                int p=_queue[head++], x=p%columns,y=p/columns;sumX+=x;sumY+=y;
                minX=Math.Min(minX,x);maxX=Math.Max(maxX,x);minY=Math.Min(minY,y);maxY=Math.Max(maxY,y);
                for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)
                {
                    int nx=x+dx,ny=y+dy;if(nx<0||nx>=columns||ny<0||ny>=rows)continue;
                    int n=ny*columns+nx;if(_mask[n]){_mask[n]=false;_queue[tail++]=n;}
                }
            }
            double w=(maxX-minX+1)*step,h=(maxY-minY+1)*step;
            if(tail<2 || tail>Math.Max(400,height*height*.0003) || w>height*.045 || h>height*.035 || Math.Max(w,h)<height*.003)continue;
            caps.Add(new(left+sumX/tail*step,top+sumY/tail*step,Math.Sqrt(w*w+h*h),tail));
        }
        Measurement? best=null;double second=0;
        foreach(var cap in caps.OrderByDescending(c=>c.Area).Take(24))
        {
            Measurement? candidate=null;
            for(double ratio=7;ratio<=14;ratio+=.5)for(int side=-1;side<=1;side+=2)for(double bow=.16;bow<=.281;bow+=.04)for(double end=-.16;end<=.001;end+=.08)
            {
                double h=cap.Width*ratio;if(h<height*.035||h>height*.38||cap.Y+h>=height)continue;
                double score=Score(pixels,width,height,stride,cap.X,cap.Y,h,side*bow*h,side*end*h,cap.Width);
                if(_previous is { } prior) score-=Math.Min(.04,Math.Abs(h/prior.Height-1)*.08);
                if(candidate is null||score>candidate.Value.Score)
                {
                    double l=Math.Max(0,cap.X+Math.Min(0,side*(bow+end)*h)-cap.Width-Math.Abs(end*h)),r=Math.Min(width,cap.X+Math.Max(0,side*(bow+end)*h)+cap.Width+Math.Abs(end*h));
                    double topY=Math.Max(0,cap.Y-cap.Width),bottom=Math.Min(height,cap.Y+h+cap.Width);
                    var bounds=new VisionCrop(l/width,topY/height,(r-l)/width,(bottom-topY)/height);
                    candidate=new(bounds,0,score,h,cap.X,cap.Y,side*bow*h,side*end*h,cap.Width);
                }
            }
            if(candidate is not { } value || value.Score<.55)continue;
            if(best is null || value.Score>best.Value.Score){second=best?.Score??0;best=value;}else second=Math.Max(second,value.Score);
        }
        if(best is { } found && second>found.Score-.06)return null;
        if(best is not { } selected)return null;
        if(_previous is { } previous && Math.Abs(selected.TargetX-previous.TargetX)<width*.08 && Math.Abs(selected.TargetY-previous.TargetY)<height*.08
            && selected.Height/previous.Height is > .75 and < 1.25)
        {
            // A one-pixel cap-edge change must not rescale the entire meter on every frame.
            double stableHeight=previous.Height*.85+selected.Height*.15,scale=stableHeight/selected.Height;
            double t=selected.Bounds.Top*height,b=Math.Min(height,selected.TargetY+stableHeight+selected.Thickness);
            selected=selected with { Height=stableHeight, Bow=selected.Bow*scale,End=selected.End*scale,
                Bounds=selected.Bounds with { Height=(b-t)/height } };
        }
        return selected with { Progress = Progress(pixels,width,height,stride,selected) };
    }
    private static double Score(ReadOnlySpan<byte> p,int width,int height,int stride,double x,double y,double h,double bow,double end,double w)
    {
        double total=0;
        for(int row=2;row<30;row++)
        {
            double t=row/30d,cx=x+bow*4*t*(1-t)+end*t,cy=y+h*t;
            double slope=(bow*4*(1-2*t)+end)/h,nx=1/Math.Sqrt(1+slope*slope),ny=-slope*nx;
            var middle=Pixel(p,width,height,stride,cx,cy);
            double a=Pixel(p,width,height,stride,cx-nx*w*.6,cy-ny*w*.6).Luma;
            double b=Pixel(p,width,height,stride,cx+nx*w*.6,cy+ny*w*.6).Luma;
            double neutral=middle.Chroma<25 && middle.Luma is >55 and <250 ? 1:0;
            double contrast=Math.Clamp(Math.Min(middle.Luma-a,middle.Luma-b)/55,0,1);
            double rimA=Pixel(p,width,height,stride,cx-nx*w*.32,cy-ny*w*.32).Luma;
            double rimB=Pixel(p,width,height,stride,cx+nx*w*.32,cy+ny*w*.32).Luma;
            total+=neutral*.2+contrast*.3+Math.Clamp(Math.Min(rimA-a,rimB-b)/50,0,1)*.5;
        }
        return Math.Min(1,total/28*1.6);
    }
    private double Progress(ReadOnlySpan<byte> p,int width,int height,int stride,Measurement meter)
    {
        int left=Math.Max(0,(int)(meter.Bounds.Left*width)),top=Math.Max(0,(int)(meter.TargetY+meter.Height*.1));
        int right=Math.Min(width,(int)Math.Ceiling((meter.Bounds.Left+meter.Bounds.Width)*width));
        int bottom=Math.Min(height,(int)Math.Ceiling(meter.TargetY+meter.Height+meter.Thickness*.4));
        int columns=right-left,rows=bottom-top,count=columns*rows;
        if(count<=0)return 0;
        if(_mask.Length<count){_mask=new bool[count];_queue=new int[count];}
        // Match the acquisition sampling scale. A one-pixel interruption at 720p
        // spans two native rows at 1440p; a fixed radius of two would split the
        // rising fill there and report only the bottom half of the meter.
        int bridgeRadius = Math.Max(2, (int)Math.Ceiling(height / 720d) + 1);
        for(int yy=0;yy<rows;yy++)for(int xx=0;xx<columns;xx++)
        {
            var sample=Pixel(p,width,height,stride,left+xx,top+yy);
            double t=(top+yy-meter.TargetY)/meter.Height;
            double cx=meter.TargetX+meter.Bow*4*t*(1-t)+meter.End*t;
            _mask[yy*columns+xx]=sample.Chroma<35&&sample.Luma>=180&&Math.Abs(left+xx-cx)<meter.Thickness*.9;
        }
        double progress=0;int bestArea=0;
        for(int start=0;start<count;start++)
        {
            if(!_mask[start])continue;
            int head=0,tail=1,minY=start/columns,maxY=minY,minX=start%columns,maxX=minX;
            _queue[0]=start;_mask[start]=false;
            while(head<tail)
            {
                int index=_queue[head++],xx=index%columns,yy=index/columns;
                minY=Math.Min(minY,yy);maxY=Math.Max(maxY,yy);minX=Math.Min(minX,xx);maxX=Math.Max(maxX,xx);
                // Bridge only a resolution-scaled, one-720p-pixel compression gap.
                for(int dy=-bridgeRadius;dy<=bridgeRadius;dy++)for(int dx=-bridgeRadius;dx<=bridgeRadius;dx++)
                {int nx=xx+dx,ny=yy+dy;if(nx<0||nx>=columns||ny<0||ny>=rows)continue;int n=ny*columns+nx;if(_mask[n]){_mask[n]=false;_queue[tail++]=n;}}
            }
            // The detached horizontal tempo tick cannot satisfy the bottom-connected, vertical fill test.
            if(top+maxY<meter.TargetY+meter.Height*.72 || maxY-minY<meter.Thickness*.8 || tail<5 || maxX-minX>meter.Height*.7)continue;
            if(tail>bestArea){bestArea=tail;progress=Math.Clamp((meter.TargetY+meter.Height-(top+minY))/meter.Height,0,1);}
        }
        return progress;
    }
    private static (double Luma,int Chroma) Pixel(ReadOnlySpan<byte> p,int width,int height,int stride,double x,double y)
    {
        int i=Math.Clamp((int)Math.Round(y),0,height-1)*stride+Math.Clamp((int)Math.Round(x),0,width-1)*4;
        int b=p[i],g=p[i+1],r=p[i+2];return((r*77+g*150+b*29)/256d,Math.Max(r,Math.Max(g,b))-Math.Min(r,Math.Min(g,b)));
    }
    private static double Hue(int r,int g,int b)
    {
        int max=Math.Max(r,Math.Max(g,b)),min=Math.Min(r,Math.Min(g,b)),delta=max-min;if(delta==0)return 0;
        double hue=max==r?60d*(g-b)/delta:max==g?120+60d*(b-r)/delta:240+60d*(r-g)/delta;return hue<0?hue+360:hue;
    }
    private static VisionCrop Expand(VisionCrop b,double factor)
    {
        double l=Math.Max(0,b.Left-b.Width*factor),t=Math.Max(0,b.Top-b.Height*factor),r=Math.Min(1,b.Left+b.Width*(1+factor)),bottom=Math.Min(1,b.Top+b.Height*(1+factor));
        return new(l,t,r-l,bottom-t);
    }
}
