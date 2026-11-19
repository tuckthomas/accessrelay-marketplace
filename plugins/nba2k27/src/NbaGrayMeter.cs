using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

internal sealed partial class NbaMeterDetector
{
    private Measurement? _grayCandidate;
    private bool _grayNeedsClear;

    private Measurement? FindGrayMeter(ReadOnlySpan<byte> pixels, int width, int height, int stride)
    {
        var prior = _grayCandidate;
        var area = prior is { } nearby ? Expand(nearby.Bounds, 1) : settings.Viewport;
        var found = SearchGray(pixels, width, height, stride, area);
        if (found is null && !Ambiguous && prior.HasValue)
            found = SearchGray(pixels, width, height, stride, settings.Viewport);
        _grayCandidate = found;
        if (found is not { } current) { _grayNeedsClear = false; return null; }
        if (prior is not { } last || Math.Sign(current.Bow) != Math.Sign(last.Bow) ||
            Math.Abs(current.TargetX - last.TargetX) > last.Height * .55 ||
            Math.Abs(current.TargetY - last.TargetY) > last.Height * .42 || current.Height / last.Height is < .85 or > 1.18)
        {
            _grayNeedsClear = current.Progress >= .65;
            return null;
        }
        // A still HUD symbol or the end of the previous shot cannot establish a new meter.
        bool continuing = _previous is { MeasuredFill: true } tracked && SameCap(tracked, last);
        if (_grayNeedsClear || !continuing && (last.Progress >= .65 || current.Progress - last.Progress < 1.5 / last.Height))
            return null;
        HasRailIdentity = true;
        return current;
    }

    private Measurement? SearchGray(ReadOnlySpan<byte> pixels, int width, int height, int stride, VisionCrop area)
    {
        var viewport = settings.Viewport;
        int step = Math.Max(1, height / 420);
        int left = (int)(Math.Max(viewport.Left, area.Left) * width);
        int top = (int)(Math.Max(viewport.Top, area.Top) * height);
        int right = (int)(Math.Min(viewport.Left + viewport.Width, area.Left + area.Width) * width);
        int bottom = (int)(Math.Min(viewport.Top + viewport.Height, area.Top + area.Height) * height);
        int cols = (right - left) / step, rows = (bottom - top) / step;
        if (cols < 2 || rows < 2) return null;
        int count = cols * rows;
        if (_mask.Length < count) { _mask = new bool[count]; _queue = new int[count]; }
        // Seed from the connected bright interior. Large neutral surfaces have no
        // paired gray edges and need not enter the component search.
        for (int y = 0; y < rows; y++)
        {
            int row = y * cols, run = 0, pos = (top + y * step) * stride + left * 4;
            for (int x = 0; x <= cols; x++, pos += 4 * step)
            {
                bool lit = false;
                if (x < cols)
                {
                    int b = pixels[pos], g = pixels[pos + 1], r = pixels[pos + 2];
                    int low = Math.Min(b, Math.Min(g, r));
                    lit = low >= 148 && Math.Max(b, Math.Max(g, r)) - low < 22;
                    _mask[row + x] = lit;
                }
                if (lit) { run++; continue; }
                if (run * step > height * .035) Array.Clear(_mask, row + x - run, run);
                run = 0;
            }
        }

        Measurement? best = null;
        for (int start = 0; start < count; start++)
        {
            if (!_mask[start]) continue;
            var blob = ReadComponent(start, cols, rows);
            int w = (blob.MaxX - blob.MinX + 1) * step, h = (blob.MaxY - blob.MinY + 1) * step;
            if (blob.Count < 3 || h < 2 * step || h > height * .38 || w > height * .12 || w > 2 * h) continue;
            double meanWidth = (double)blob.Count * step * step / h;
            if (meanWidth < 1 || meanWidth > height * .032) continue;
            int footCount = 0;
            double footX = 0;
            for (int k = 0; k < blob.Count; k++)
            {
                int p = _queue[k];
                if (p / cols < blob.MaxY - 1) continue;
                footX += p % cols; footCount++;
            }
            double xEnd = left + step * footX / footCount, yEnd = top + step * blob.MaxY;
            var candidate = FitGray(pixels, width, height, stride, xEnd, yEnd, h, meanWidth, step);
            if (candidate is not { } meter) continue;
            if (meter.TargetX < viewport.Left * width || meter.TargetX >= (viewport.Left + viewport.Width) * width ||
                meter.TargetY < viewport.Top * height) continue;
            if (best is { } other && !SameCap(meter, other)) { Ambiguous = true; return null; }
            if (best is null || meter.Score > best.Value.Score) best = meter;
        }
        return best;
    }

    private Measurement? FitGray(ReadOnlySpan<byte> pixels, int width, int height, int stride,
        double xEnd, double yEnd, double fillHeight, double meanWidth, int step)
    {
        double known = _grayCandidate?.Height ?? (_sessionMeasuredFill ? _sessionHeight : 0);
        double estimated = meanWidth * 18;
        ReadOnlySpan<double> heights = [known, known * 1.05, known * .95, estimated, estimated * .9, estimated * 1.12, estimated * .8];
        Measurement? best = null;
        double bestFit = double.NegativeInfinity;
        foreach (double h in heights)
        {
            if (h < height * .035 || h > height * .38 || fillHeight > h * 1.05 || fillHeight < h * .055 || yEnd < h) continue;
            double bar = h / 8.4;
            for (int side = -1; side <= 1; side += 2)
            {
                // The bottom of the curved strip is slightly past the tip on the horizontal axis.
                double center = xEnd + side * .04 * h, y = yEnd - .96 * h;
                foreach (double shift in (ReadOnlySpan<double>)[0, -.18, .18])
                {
                    double x = center + shift * bar;
                    if (!HasGrayEdges(pixels, width, height, stride, x, y, side, h, bar)) continue;
                    var reading = ReadRibbon(pixels, width, height, stride, x, y, side,
                        bar, h, verifyOutline: true, out double outline);
                    if (reading is not { } m || outline < .81 ||
                        Math.Abs(m.Progress * .9 * m.Height - fillHeight) > Math.Max(2 * step, bar * .65)) continue;
                    double reference = known > 0 ? known : estimated;
                    double fit = outline - .65 * Math.Abs(m.Height / reference - 1)
                        - .30 * Math.Abs(m.Progress * .9 * m.Height - fillHeight) / bar;
                    if (fit > bestFit)
                    {
                        best = m with { Score = outline };
                        bestFit = fit;
                    }
                }
            }
        }
        return best;
    }

    private static bool HasGrayEdges(ReadOnlySpan<byte> pixels, int width, int height, int stride,
        double cx, double cy, int side, double h, double bar)
    {
        int matched = 0;
        foreach (double t in (ReadOnlySpan<double>)[.24, .39, .55, .71, .84])
        {
            double x = cx + side * h * (.76 * t * (1 - t) - .07 * t), y = cy + h * t;
            double slope = side * (.76 * (1 - 2 * t) - .07), dx = bar / Math.Sqrt(1 + slope * slope), dy = -slope * dx;
            var a = Pixel(pixels, width, height, stride, x - .38 * dx, y - .38 * dy);
            var b = Pixel(pixels, width, height, stride, x + .38 * dx, y + .38 * dy);
            if (a.Chroma >= 25 || b.Chroma >= 25 || a.Luma is < 62 or > 168 || Math.Abs(a.Luma - b.Luma) > 15) continue;
            double shade = (a.Luma + b.Luma) * .5;
            if (OutsideRails(pixels, width, height, stride, x, y, dx, dy, shade, 1.15) ||
                OutsideRails(pixels, width, height, stride, x, y, dx, dy, shade, .78))
                matched++;
        }
        return matched >= 3;
    }
}
