using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

internal sealed partial class NbaMeterDetector
{
    private static double CurvedProgress(double height, double leadingEdge) =>
        Math.Clamp((.96 * height - leadingEdge) / (.90 * height), 0, 1);
    // The tilted target cap fixes the orientation and scale of the curved meter.
    // Measure the bottom-connected bright strip against its own gray rails.
    private Measurement? ReadCurvedFill(ReadOnlySpan<byte> pixels, int width, int height, int stride, Cap cap, double hue)
    {
        bool CapPixel(byte b, byte g, byte r)
        {
            int high = Math.Max(r, Math.Max(g,b)), low = Math.Min(r, Math.Min(g,b));
            if (high < 100 || high-low < 40) return false;
            double difference = Math.Abs(Hue(r,g,b)-hue);
            return Math.Min(difference,360-difference) <= settings.ColorToleranceDegrees;
        }
        double sx=0, sy=0, xx=0, xy=0, yy=0;
        int n=0;
        for (int y=cap.Top;y<=cap.Bottom;y++) for (int x=cap.Left;x<=cap.Right;x++)
        {
            int i=y*stride+4*x;
            if (!CapPixel(pixels[i],pixels[i+1],pixels[i+2])) continue;
            double dx=x-cap.Left, dy=y-cap.Top;
            sx+=dx; sy+=dy; xx+=dx*dx; xy+=dx*dy; yy+=dy*dy; n++;
        }
        if (n<10) return null;
        sx/=n; sy/=n; xx=xx/n-sx*sx; xy=xy/n-sx*sy; yy=yy/n-sy*sy;
        double spread=Math.Sqrt((xx-yy)*(xx-yy)+4*xy*xy);
        if (xx+yy+spread < 2*(xx+yy-spread)) return null;
        double angle=.5*Math.Atan2(2*xy,xx-yy), vx=Math.Cos(angle), vy=Math.Sin(angle);
        double tilt=-vy/vx;
        if (Math.Abs(tilt) is < .3 or > 1.8) return null;
        double min=double.PositiveInfinity,max=double.NegativeInfinity;
        for (int y=cap.Top;y<=cap.Bottom;y++) for (int x=cap.Left;x<=cap.Right;x++)
        {
            int i=y*stride+4*x;
            if (!CapPixel(pixels[i],pixels[i+1],pixels[i+2])) continue;
            double along=(x-cap.Left)*vx+(y-cap.Top)*vy;
            min=Math.Min(min,along); max=Math.Max(max,along);
        }
        double bar=max-min+1, side=Math.Sign(tilt), cx=cap.Left+sx, cy=cap.Top+sy;
        if (_previous is { MeasuredFill: true } prior && Math.Abs(cx-prior.TargetX)<width*.04 &&
            Math.Abs(cy-prior.TargetY)<height*.04 && bar/prior.Thickness is >.8 and <1.25)
            bar=.75*prior.Thickness+.25*bar;
        double nominal=bar*8.2;
        if (nominal<height*.035 || nominal>height*.38 || cy+nominal*1.24>=height) return null;
        int first=(int)Math.Ceiling(.06*nominal), last=(int)(1.24*nominal);
        // Sample the shade on both rails. Chroma and the continuous bright strip below
        // reject green court text and the detached white tempo tick next to the cap.
        Span<int> histogram=stackalloc int[256];
        histogram.Clear();
        for(int row=first;row<=last;row+=2)
        {
            double t=row/nominal;
            if(t<.16 || t>.88)continue;
            var (x,dx,dy)=CrossSection(t);
            foreach(double offset in (ReadOnlySpan<double>)[-.45,-.33,.33,.45])
            {
                var sample=Pixel(pixels,width,height,stride,x+dx*offset,cy+row+dy*offset);
                if(sample.Chroma<25)histogram[(int)Math.Round(sample.Luma)]++;
            }
        }
        int shade=0,bestCount=0;
        for(int level=66;level<=164;level++)
        {
            int count=0; for(int i=level-3;i<=level+3;i++)count+=histogram[i];
            if(count>bestCount){bestCount=count;shade=level;}
        }
        if(bestCount==0)return null;
        int body=0, bodyRows=0, start=-1, end=-1, litRows=0, bestStart=0, bestEnd=0, bestLit=0;
        int gap=Math.Max(3,(int)Math.Round(bar*.20));
        Span<bool> rail=stackalloc bool[11];
        ReadOnlySpan<double> offsets=[-.60,-.45,-.33,-.22,-.10,0,.10,.22,.33,.45,.60];
        for(int row=first;row<=last;row++)
        {
            double t=row/nominal;
            var (x,dx,dy)=CrossSection(t);
            int bright=0;
            for(int i=0;i<offsets.Length;i++)
            {
                var v=Pixel(pixels,width,height,stride,x+dx*offsets[i],cy+row+dy*offsets[i]);
                rail[i]=Math.Abs(v.Luma-shade)<10 && v.Chroma<25;
                if(i is >=3 and <=7 && v.Chroma<25 && v.Luma>=Math.Max(136,shade+37))bright++;
            }
            if(t is >=.16 and <=.88)
            {
                bodyRows++;
                if((rail[1]||rail[2]||rail[3]) && (rail[7]||rail[8]||rail[9]))body++;
            }
            if(bright<2 || !(rail[0]||rail[1]||rail[2]||rail[8]||rail[9]||rail[10]))continue;
            if(start<0 || row-end>gap){start=row;litRows=0;}
            end=row;litRows++;
            if(t is >.83 and <1.12 && litRows>=5 && end-start>=Math.Max(4,.38*bar) && litRows>bestLit)
            {bestStart=start;bestEnd=end;bestLit=litRows;}
        }
        double confidence=body/(double)Math.Max(1,bodyRows);
        if(bestLit==0 || confidence<.72 || bestLit<(bestEnd-bestStart+1)*.8)return null;
        double measuredHeight=bestEnd/.96, progress=CurvedProgress(measuredHeight,bestStart);
        double left=Math.Max(0,cx-(side<0?.27:.10)*measuredHeight-bar);
        double right=Math.Min(width,cx+(side>0?.27:.10)*measuredHeight+bar);
        double top=Math.Max(0,cy-bar),bottom=Math.Min(height,cy+measuredHeight+bar);
        return new Measurement(new VisionCrop(left/width,top/height,(right-left)/width,(bottom-top)/height),
            progress,confidence,measuredHeight,cx,cy,side*.19*measuredHeight,-side*.07*measuredHeight,bar)
            { MeasuredFill = true, FillTopFromCap = bestStart };

        (double X,double Dx,double Dy) CrossSection(double t)
        {
            double slope=side*(.76*(1-2*t)-.07);
            double dx=bar/Math.Sqrt(1+slope*slope);
            return (cx+side*nominal*(.76*t*(1-t)-.07*t),dx,-slope*dx);
        }
    }
}
