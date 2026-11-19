using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

internal interface INbaMeterDetector
{
    NbaMeterDetector.Measurement? Detect(ReadOnlySpan<byte> pixels, int width, int height, int stride);
    bool Ambiguous { get; }
    bool HasRailIdentity => false;
    void Reset();
}

/// <summary>CPU-only curved-meter geometry. Acquisition never consults a player, tag, court or neural model.</summary>
internal sealed partial class NbaMeterDetector(NbaMeterSettings settings) : INbaMeterDetector
{
    internal readonly record struct Measurement(VisionCrop Bounds, double Progress, double Score, double Height, double TargetX, double TargetY,
        double Bow = 0, double End = 0, double Thickness = 0)
    {
        internal bool MeasuredFill { get; init; }
        internal double? FillTopFromCap { get; init; }
    }
    private bool[] _mask = [];
    private int[] _queue = [];
    private Measurement? _previous;
    private double _velocityX, _velocityY, _sessionHeight;
    private bool _sessionMeasuredFill;
    private int _emptyOutlineStreak, _sessionShiftCount;
    private readonly record struct Cap(double X, double Y, double Width, int Area, int Left, int Top, int Right, int Bottom);
    public bool Ambiguous { get; private set; }
    public bool HasRailIdentity { get; private set; }
    private int _caplessFrames;
    public void Reset() { HasRailIdentity = _grayNeedsClear = false; _caplessFrames = 0; _grayCandidate = _previous = null; _velocityX = _velocityY = 0; _emptyOutlineStreak = 0; Ambiguous = false; }
    public void ResetSession() { Reset(); _sessionHeight = 0; _sessionShiftCount = 0; }

    public Measurement? Detect(ReadOnlySpan<byte> pixels, int width, int height, int stride)
    {
        Ambiguous = false;
        HasRailIdentity = false;
        var search = _previous is { } last ? Expand(ShiftPredicted(last.Bounds, _velocityX, _velocityY), .6) : settings.Viewport;
        var result = Search(pixels, width, height, stride, search);
        bool followingGray = _grayCandidate.HasValue && !Ambiguous && result is not { MeasuredFill: true };
        if (followingGray)
            result = FindGrayMeter(pixels, width, height, stride);
        if (!Ambiguous && result is not { MeasuredFill: true } &&
            _previous is { MeasuredFill: true } prior && _caplessFrames < 3)
        {
            var recovered = TrackRibbon(pixels, width, height, stride, prior, result);
            if (HasRailIdentity)
            {
                _caplessFrames++;
                if (recovered is null) return null;
                result = recovered;
            }
        }
        if (!HasRailIdentity && !Ambiguous && result is null && _previous is not null)
            result = Search(pixels, width, height, stride, settings.Viewport);
        if (!followingGray && !HasRailIdentity && !Ambiguous && result is null)
            result = FindGrayMeter(pixels, width, height, stride);
        else if (!followingGray && !HasRailIdentity)
            _grayCandidate = null;
        if (!HasRailIdentity && result is { MeasuredFill: true }) _caplessFrames = 0;
        // The predictor bounds how long identity may survive a missing detection.
        if (result is { } found)
        {
            if (found.Progress <= .03 && found.Score < .75)
                _emptyOutlineStreak++;
            else
                _emptyOutlineStreak = 0;

            // Persistent weak empty outlines must not trap the search crop away from the real meter,
            // while brief low-fill outlines (e.g., far-court shots) still retain localized tracking.
            if (_emptyOutlineStreak >= 4)
            {
                _previous = null;
                _velocityX = _velocityY = 0;
                _emptyOutlineStreak = 0;
            }
            else
            {
                if (_previous is { } previous)
                {
                    double dx = Math.Clamp(found.Bounds.Left - previous.Bounds.Left, -.06, .06);
                    double dy = Math.Clamp(found.Bounds.Top - previous.Bounds.Top, -.06, .06);
                    _velocityX = _velocityX * .4 + dx * .6;
                    _velocityY = _velocityY * .4 + dy * .6;
                }
                else
                {
                    _velocityX = _velocityY = 0;
                }
                _previous = found;
                if (found.Progress >= .25 && found.Score >= .80)
                {
                    if (_sessionHeight <= 0 || found.MeasuredFill != _sessionMeasuredFill)
                    { _sessionHeight = found.Height; _sessionMeasuredFill = found.MeasuredFill; _sessionShiftCount = 0; }
                    else if (found.Height / _sessionHeight is > .80 and < 1.20)
                    {
                        _sessionHeight = _sessionHeight * .85 + found.Height * .15;
                        _sessionShiftCount = 0;
                    }
                    else if (++_sessionShiftCount >= 3)
                    {
                        // Accept genuine camera/meter-size changes only after sustained confirmation.
                        _sessionHeight = found.Height;
                        _sessionShiftCount = 0;
                    }
                }
            }
        }
        else
        {
            _velocityX *= .5;
            _velocityY *= .5;
        }
        return result;
    }
    private Measurement? TrackRibbon(ReadOnlySpan<byte> pixels, int width, int height, int stride, Measurement prior, Measurement? tip)
    {
        // The search is bounded by the last real cap and samples native-resolution pixels.
        // Check both the rails and their outer boundaries so a flat gray patch cannot hold identity.
        double dx = Math.Clamp(_velocityX * width, -prior.Thickness, prior.Thickness);
        double dy = Math.Clamp(_velocityY * height, -prior.Thickness, prior.Thickness);
        if (tip is { } current && Math.Abs(current.TargetX - prior.TargetX) < width * .04 &&
            Math.Abs(current.TargetY - prior.TargetY) < height * .04)
        {
            dx = current.TargetX - prior.TargetX;
            dy = current.TargetY - prior.TargetY;
        }
        double bestReading = 0;
        Measurement? result = null;
        double step = Math.Max(1, prior.Thickness * .18);
        foreach (double y in (ReadOnlySpan<double>)[0, -step, step])
        foreach (double x in (ReadOnlySpan<double>)[0, -step, step])
        {
            var reading = ReadRibbon(pixels, width, height, stride, prior.TargetX + dx + x, prior.TargetY + dy + y,
                Math.Sign(prior.Bow), prior.Thickness, prior.Height, verifyOutline: true, out double score);
            if (score > 0) HasRailIdentity = true;
            if (reading is not { } m || score <= bestReading) continue;
            bestReading = score;
            result = StabilizeHeight(m, prior.Height, height);
        }
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
            var (minX, maxX, minY, maxY, tail, sumX, sumY) = ReadComponent(start, columns, rows);
            double w=(maxX-minX+1)*step,h=(maxY-minY+1)*step;
            if(tail<2 || tail>Math.Max(400,height*height*.0003) || w>height*.045 || h>height*.035 || Math.Max(w,h)<height*.003)continue;
            caps.Add(new(left+sumX/tail*step,top+sumY/tail*step,Math.Sqrt(w*w+h*h),tail,
                Math.Max(0,left+minX*step-step+1),Math.Max(0,top+minY*step-step+1),
                Math.Min(width-1,left+maxX*step+step-1),Math.Min(height-1,top+maxY*step+step-1)));
        }
        Measurement? best=null;double second=0;
        bool hasReliablePrior = _previous is { } priorState && priorState.Progress >= .15;
        foreach(var cap in caps.OrderByDescending(c=>c.Area).Take(24))
        {
            Measurement? candidate=null;
            double baseWidth = hasReliablePrior && _previous is { } priorCap && Math.Abs(cap.X - priorCap.TargetX) < width * .08 && Math.Abs(cap.Y - priorCap.TargetY) < height * .08
                ? Math.Max(cap.Width, priorCap.Thickness * .85) : cap.Width;
            double bestCoarse = double.NegativeInfinity, bestR = 10.5, bestBow = .22, bestEnd = -.04; int bestSide = 1;
            for(double ratio=7.5;ratio<=13.6;ratio+=1.5)for(int side=-1;side<=1;side+=2)for(double bow=.18;bow<=.261;bow+=.08)for(double end=-.20;end<=.081;end+=.14)
            {
                double h=baseWidth*ratio;if(h<height*.035||h>height*.38||cap.Y+h>=height)continue;
                double score=Score(pixels,width,height,stride,cap.X,cap.Y,h,side*bow*h,side*end*h,baseWidth);
                if(hasReliablePrior && _previous is { } prior) score-=Math.Min(.18,Math.Abs(h/prior.Height-1)*.35);
                else if(_sessionHeight>0 && h/_sessionHeight is > .80 and < 1.20) score-=Math.Min(.12,Math.Abs(h/_sessionHeight-1)*.30);
                if(score>bestCoarse){bestCoarse=score;bestR=ratio;bestSide=side;bestBow=bow;bestEnd=end;}
            }
            bool nearPrevious = hasReliablePrior && _previous is { } trackedCap && Math.Abs(cap.X-trackedCap.TargetX)<width*.04 && Math.Abs(cap.Y-trackedCap.TargetY)<height*.04;
            if(bestCoarse >= .38 || nearPrevious)
            {
                double rMin=Math.Max(7,bestR-1), rMax=Math.Min(14,bestR+1);
                double bMin=Math.Max(.16,bestBow-.04), bMax=Math.Min(.28,bestBow+.04);
                double eMin=Math.Max(-.24,bestEnd-.08), eMax=Math.Min(.08,bestEnd+.08);
                for(double ratio=rMin;ratio<=rMax+.01;ratio+=.5)for(double bow=bMin;bow<=bMax+.005;bow+=.04)for(double end=eMin;end<=eMax+.005;end+=.08)
                {
                    double h=baseWidth*ratio;if(h<height*.035||h>height*.38||cap.Y+h>=height)continue;
                    double score=Score(pixels,width,height,stride,cap.X,cap.Y,h,bestSide*bow*h,bestSide*end*h,baseWidth);
                    if(hasReliablePrior && _previous is { } prior) score-=Math.Min(.18,Math.Abs(h/prior.Height-1)*.35);
                    else if(_sessionHeight>0 && h/_sessionHeight is > .80 and < 1.20) score-=Math.Min(.12,Math.Abs(h/_sessionHeight-1)*.30);
                    if(candidate is null||score>candidate.Value.Score)
                    {
                        double l=Math.Max(0,cap.X+Math.Min(0,bestSide*(bow+end)*h)-baseWidth-Math.Abs(end*h)),r=Math.Min(width,cap.X+Math.Max(0,bestSide*(bow+end)*h)+baseWidth+Math.Abs(end*h));
                        double topY=Math.Max(0,cap.Y-baseWidth),bottom=Math.Min(height,cap.Y+h+baseWidth);
                        var bounds=new VisionCrop(l/width,topY/height,(r-l)/width,(bottom-topY)/height);
                        candidate=new(bounds,0,score,h,cap.X,cap.Y,bestSide*bow*h,bestSide*end*h,baseWidth);
                    }
                }
            }
            // Validate the previous full ribbon against this frame. A fragmented cap
            // must not force a shorter meter when the original ribbon is still visible.
            if (hasReliablePrior && _previous is { } tracked && Math.Abs(cap.X-tracked.TargetX)<width*.04 && Math.Abs(cap.Y-tracked.TargetY)<height*.04)
            {
                double score=Score(pixels,width,height,stride,cap.X,cap.Y,tracked.Height,tracked.Bow,tracked.End,tracked.Thickness);
                if(score>=.55 && (candidate is null || score>=candidate.Value.Score-.015))
                {
                    double dx=(cap.X-tracked.TargetX)/width,dy=(cap.Y-tracked.TargetY)/height;
                    double l=Math.Clamp(tracked.Bounds.Left+dx,0,1),t=Math.Clamp(tracked.Bounds.Top+dy,0,1);
                    candidate=tracked with { TargetX=cap.X,TargetY=cap.Y,Score=score, MeasuredFill=false, FillTopFromCap=null,
                        Bounds=new(l,t,Math.Min(tracked.Bounds.Width,1-l),Math.Min(tracked.Bounds.Height,1-t)) };
                }
            }
            if (ReadCurvedFill(pixels, width, height, stride, cap, targetHue) is { } filled) candidate = filled;
            if(candidate is not { } value || value.Score<.55)continue;
            bool sameMeter = best is { } current && SameCap(value,current);
            if(best is null || value.Score>best.Value.Score){if(!sameMeter)second=best?.Score??0;best=value;}else if(!sameMeter)second=Math.Max(second,value.Score);
        }
        if(best is { } found && second>found.Score-.06){Ambiguous=true;return null;}
        if(best is not { } selected)return null;
        double referenceHeight = 0;
        if (_previous is { } previous && previous.MeasuredFill == selected.MeasuredFill
            && (hasReliablePrior || previous.MeasuredFill) && Math.Abs(selected.TargetX - previous.TargetX) < width * .08
            && Math.Abs(selected.TargetY - previous.TargetY) < height * .08 && selected.Height / previous.Height is > .75 and < 1.25)
            referenceHeight = previous.Height;
        else if (_sessionHeight > 0 && selected.MeasuredFill == _sessionMeasuredFill && selected.Height / _sessionHeight is > .80 and < 1.20)
            referenceHeight = _sessionHeight;
        if (referenceHeight > 0)
            selected = StabilizeHeight(selected, referenceHeight, height);
        return selected.MeasuredFill ? selected : selected with { Progress = Progress(pixels,width,height,stride,selected) };
    }
    // The queued indices remain available to the caller until the next component.
    private (int MinX, int MaxX, int MinY, int MaxY, int Count, double SumX, double SumY) ReadComponent(int start, int columns, int rows)
    {
        int head = 0, tail = 1, minX = start % columns, maxX = minX, minY = start / columns, maxY = minY;
        double sumX = 0, sumY = 0;
        _mask[start] = false;
        _queue[0] = start;
        while (head < tail)
        {
            int p = _queue[head++], x = p % columns, y = p / columns;
            sumX += x; sumY += y;
            minX = Math.Min(minX, x); maxX = Math.Max(maxX, x);
            minY = Math.Min(minY, y); maxY = Math.Max(maxY, y);
            for (int yy = Math.Max(0, y - 1); yy <= Math.Min(rows - 1, y + 1); yy++)
            for (int xx = Math.Max(0, x - 1); xx <= Math.Min(columns - 1, x + 1); xx++)
            {
                int neighbor = yy * columns + xx;
                if (!_mask[neighbor]) continue;
                _mask[neighbor] = false;
                _queue[tail++] = neighbor;
            }
        }
        return (minX, maxX, minY, maxY, tail, sumX, sumY);
    }
    internal static Measurement StabilizeHeight(Measurement meter, double previousHeight, int pictureHeight)
    {
        // Stabilize the rail length only. The leading edge comes from this frame, so
        // a changing patch of color at the bottom cannot delay real fill movement.
        double height = previousHeight * .85 + meter.Height * .15;
        double scale = height / meter.Height;
        double bottom = Math.Min(pictureHeight, meter.TargetY + height + meter.Thickness);
        return meter with
        {
            Height = height, Bow = meter.Bow * scale, End = meter.End * scale,
            Bounds = meter.Bounds with { Height = bottom / pictureHeight - meter.Bounds.Top },
            Progress = meter.FillTopFromCap is { } leadingEdge ? CurvedProgress(height, leadingEdge) : meter.Progress
        };
    }
    private static bool SameCap(Measurement a,Measurement b)
    {
        double radius=Math.Min(a.Thickness,b.Thickness)*.75;
        if(Math.Abs(a.TargetX-b.TargetX)>radius || Math.Abs(a.TargetY-b.TargetY)>radius || a.Height/b.Height is < .75 or > 1.25)return false;
        double intersectionWidth=Math.Max(0,Math.Min(a.Bounds.Left+a.Bounds.Width,b.Bounds.Left+b.Bounds.Width)-Math.Max(a.Bounds.Left,b.Bounds.Left));
        double intersectionHeight=Math.Max(0,Math.Min(a.Bounds.Top+a.Bounds.Height,b.Bounds.Top+b.Bounds.Height)-Math.Max(a.Bounds.Top,b.Bounds.Top));
        return intersectionWidth*intersectionHeight>=.6*Math.Min(a.Bounds.Width*a.Bounds.Height,b.Bounds.Width*b.Bounds.Height);
    }
    private static double Score(ReadOnlySpan<byte> p,int width,int height,int stride,double x,double y,double h,double bow,double end,double w)
    {
        double total=0;int supported=0;
        for(int row=2;row<30;row++)
        {
            double t=row/30d,cx=x+bow*4*t*(1-t)+end*t,cy=y+h*t;
            double slope=(bow*4*(1-2*t)+end)/h,nx=1/Math.Sqrt(1+slope*slope),ny=-slope*nx;
            var middle=Pixel(p,width,height,stride,cx,cy);
            var outA=Pixel(p,width,height,stride,cx-nx*w*.6,cy-ny*w*.6);
            var outB=Pixel(p,width,height,stride,cx+nx*w*.6,cy+ny*w*.6);
            double neutral=middle.Chroma<25 && middle.Luma>55 ? 1:0;
            double sepA=Math.Max(Math.Abs(middle.Luma-outA.Luma),(outA.Chroma-middle.Chroma)*.7);
            double sepB=Math.Max(Math.Abs(middle.Luma-outB.Luma),(outB.Chroma-middle.Chroma)*.7);
            double contrast=Math.Clamp(Math.Min(sepA,sepB)/55,0,1);
            var rimA=Pixel(p,width,height,stride,cx-nx*w*.32,cy-ny*w*.32);
            var rimB=Pixel(p,width,height,stride,cx+nx*w*.32,cy+ny*w*.32);
            double rimSepA=Math.Max(Math.Abs(rimA.Luma-outA.Luma),(outA.Chroma-rimA.Chroma)*.7);
            double rimSepB=Math.Max(Math.Abs(rimB.Luma-outB.Luma),(outB.Chroma-rimB.Chroma)*.7);
            var innerA=Pixel(p,width,height,stride,cx-nx*w*.1,cy-ny*w*.1);
            var innerB=Pixel(p,width,height,stride,cx+nx*w*.1,cy+ny*w*.1);
            if(middle.Chroma<35 && innerA.Chroma<35 && innerB.Chroma<35
                && Math.Min(middle.Luma,Math.Min(innerA.Luma,innerB.Luma))>70
                && Math.Max(middle.Luma,Math.Max(innerA.Luma,innerB.Luma))-Math.Min(middle.Luma,Math.Min(innerA.Luma,innerB.Luma))<18)supported++;
            total+=neutral*.2+contrast*.3+Math.Clamp(Math.Min(rimSepA,rimSepB)/50,0,1)*.5;
        }
        // Penalize candidates whose gray ribbon interior keeps running past t = 1.0 (truncated early fit).
        int pastEndRibbon = 0;
        for(int ext=1;ext<=3;ext++)
        {
            double t=1d+ext*.045,cx=x+bow*4*t*(1-t)+end*t,cy=y+h*t;
            if(cy>=height-1)break;
            double slope=(bow*4*(1-2*t)+end)/h,nx=1/Math.Sqrt(1+slope*slope),ny=-slope*nx;
            var middle=Pixel(p,width,height,stride,cx,cy);
            var innerA=Pixel(p,width,height,stride,cx-nx*w*.1,cy-ny*w*.1);
            var innerB=Pixel(p,width,height,stride,cx+nx*w*.1,cy+ny*w*.1);
            if(middle.Chroma<35 && innerA.Chroma<35 && innerB.Chroma<35
                && Math.Min(middle.Luma,Math.Min(innerA.Luma,innerB.Luma))>70
                && Math.Max(middle.Luma,Math.Max(innerA.Luma,innerB.Luma))-Math.Min(middle.Luma,Math.Min(innerA.Luma,innerB.Luma))<18)
                pastEndRibbon++;
        }
        // A ribbon has a flat neutral interior across its width. Poster/text strokes
        // below a green feedback box can otherwise achieve a plausible edge score.
        return supported>=12 ? Math.Max(0, Math.Min(1,total/28*1.6*(supported>=14?1d:.88)) - pastEndRibbon*.12) : 0;
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
            bool bottomAnchored = top+maxY>=meter.TargetY+meter.Height*.82 && maxX-minX<=meter.Thickness*2.2;
            double minVerticalSpan = bottomAnchored ? Math.Max(3, meter.Thickness*.35) : meter.Thickness*.8;
            if(top+maxY<meter.TargetY+meter.Height*.72 || maxY-minY<minVerticalSpan || tail<5 || maxX-minX>meter.Height*.7)continue;
            // The top tenth contains the colored cap and is excluded from this scan.
            // Fill reaches 100% at that measurable cap boundary, not inside the cap.
            if(tail>bestArea){bestArea=tail;progress=Math.Clamp((meter.TargetY+meter.Height-(top+minY))/(meter.Height*.9),0,1);}
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
    private static VisionCrop ShiftPredicted(VisionCrop b, double dx, double dy)
    {
        double l = Math.Clamp(b.Left + dx, 0, Math.Max(0, 1 - b.Width));
        double t = Math.Clamp(b.Top + dy, 0, Math.Max(0, 1 - b.Height));
        return b with { Left = l, Top = t };
    }
    private static VisionCrop Expand(VisionCrop b,double factor)
    {
        double l=Math.Max(0,b.Left-b.Width*factor),t=Math.Max(0,b.Top-b.Height*factor),r=Math.Min(1,b.Left+b.Width*(1+factor)),bottom=Math.Min(1,b.Top+b.Height*(1+factor));
        return new(l,t,r-l,bottom-t);
    }
}
