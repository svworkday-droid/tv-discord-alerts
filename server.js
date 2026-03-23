//@version=5
// ╔══════════════════════════════════════════════════════════════════╗
// ║   WVF ULTIMATE — STRICT INTRADAY (SPX/SPY/Stocks)             ║
// ║   Session: 9:30am – 4:00pm ET only                            ║
// ║   Full reset at 9:30am — no previous day carry                ║
// ╚══════════════════════════════════════════════════════════════════╝
indicator("WVF Intraday — SPX", overlay=true, max_lines_count=500, max_labels_count=500)

// ════════════════════════════════════════════════════════
// INPUTS
// ════════════════════════════════════════════════════════
grpWVF = "WVF Settings"
pd     = input.int(22,    title="WVF Lookback",           group=grpWVF)
bbl    = input.int(20,    title="BB Length",               group=grpWVF)
mult   = input.float(2.0, title="BB Multiplier",           group=grpWVF)
lb     = input.int(50,    title="Percentile Lookback",     group=grpWVF)
ph     = input.float(0.85,title="Top Percentile",          group=grpWVF)

grpVol  = "Volume & RSI"
volMult = input.float(1.1, title="Volume Spike Multiplier",group=grpVol)
rsiLen  = input.int(14,    title="RSI Length",             group=grpVol)
rsiOB   = input.int(70,    title="RSI Overbought",         group=grpVol)
rsiOS   = input.int(30,    title="RSI Oversold",           group=grpVol)

grpVis   = "Visual"
showEMA  = input.bool(true,  title="Show EMA Ribbon?",     group=grpVis)
showVWAP = input.bool(true,  title="Show VWAP Bands?",     group=grpVis)
showDash = input.bool(true,  title="Show Dashboard?",      group=grpVis)
showTgts = input.bool(true,  title="Show Targets?",        group=grpVis)
showSL   = input.bool(true,  title="Show Stop Loss?",      group=grpVis)
showChan = input.bool(true,  title="Show Chandelier Stop?",group=grpVis)
fwdBars      = input.int(40,     title="Target line length",   group=grpVis, minval=5, maxval=200)
cleanMode    = input.bool(false, title="Clean Mode — hide historical labels?", group=grpVis)
histMode     = input.bool(true,  title="History Mode — show icons instead of labels?", group=grpVis)

grpFilt     = "Filters"
filterMixed = input.bool(true,     title="Suppress mixed trend signals?", group=grpFilt)
useHTFBias  = input.bool(true,     title="Use HTF EMA Bias?",             group=grpFilt)
htfRes      = input.timeframe("60",title="HTF Timeframe",                 group=grpFilt)
requireVWAP = input.bool(true,     title="Require VWAP Reclaim on Buy?",  group=grpFilt)

grpRisk  = "Risk"
atrLen   = input.int(14,    title="ATR Length",            group=grpRisk)
atrSLMul = input.float(1.5, title="ATR Stop Multiplier",   group=grpRisk, step=0.25)
minRR    = input.float(1.2, title="Min R:R",               group=grpRisk, step=0.1)
chanMult = input.float(2.0, title="Chandelier ATR Mult",   group=grpRisk, step=0.25)

// ════════════════════════════════════════════════════════
// SESSION DETECTION — strict ET timezone
// ════════════════════════════════════════════════════════
etHour   = hour(time,   "America/New_York")
etMinute = minute(time, "America/New_York")
etTime   = etHour * 100 + etMinute

isRTH      = etTime >= 930 and etTime < 1600
isPreMarket = etTime < 930
isAfterMkt = etTime >= 1600

// Session open: FIRST bar at or after 9:30am
// Use ta.change on date+session combo for reliability

// ════════════════════════════════════════════════════════
// TIMEFRAME ADAPTIVE PARAMETERS
// Automatically adjusts all parameters based on chart TF
// Works on 1m, 3m, 5m, 10m, 15m, 30m, 65m, 1hr
// ════════════════════════════════════════════════════════
tfMins = timeframe.in_seconds() / 60   // current TF in minutes

// Cooldown: how many bars to wait between signals
// 5min=12bars(1hr), 15min=6bars(1.5hr), 65min=2bars(2.2hr)
tfCooldown = tfMins <= 1 ? 20 : tfMins <= 5 ? 12 : tfMins <= 15 ? 6 : tfMins <= 30 ? 4 : tfMins <= 65 ? 2 : 1

// Target cooldown after T1 hit before re-entry
tfT1Cooldown = tfMins <= 5 ? 8 : tfMins <= 15 ? 4 : tfMins <= 65 ? 2 : 1

// Min bars after entry before exit allowed
tfMinEntry = tfMins <= 5 ? 3 : tfMins <= 15 ? 2 : 1

// ATR stop multiplier — wider on higher TF
tfSLMult = tfMins <= 5 ? atrSLMul : tfMins <= 15 ? atrSLMul + 0.25 : tfMins <= 65 ? atrSLMul + 0.5 : atrSLMul + 1.0

// Min R:R — higher bar on higher TF
tfMinRR = tfMins <= 5 ? minRR : tfMins <= 15 ? minRR + 0.1 : tfMins <= 65 ? minRR + 0.3 : minRR + 0.5

// Opening range window (first 30 min = different bar count by TF)
tfOpeningMins = 30  // always 30 min window
isOpeningRange = etTime >= 930 and etTime < (930 + tfOpeningMins)

// Session open detection — works on all TFs
// Uses date change within RTH to catch first RTH bar
// Session open: fires on the FIRST bar that is in RTH each day
// Tracks previous bar's RTH state — when it flips from false to true = session open
// This is reliable on ALL timeframes including 15m, 65m, and Bar Replay
isSessionOpen = isRTH and not isRTH[1]

// TF label for dashboard
tfLabel = tfMins <= 1 ? "1m" : tfMins <= 3 ? "3m" : tfMins <= 5 ? "5m" : tfMins <= 10 ? "10m" : tfMins <= 15 ? "15m" : tfMins <= 30 ? "30m" : tfMins <= 65 ? "65m" : "1H+"

// ════════════════════════════════════════════════════════
// LINE/LABEL ARRAYS — declared at top
// ════════════════════════════════════════════════════════
var line[]  allLines  = array.new_line()
var label[] allLabels = array.new_label()
var int     sellCount = 0
var int     buyCount  = 0

f_clear_all() =>
    while array.size(allLines) > 0
        line.delete(array.pop(allLines))
    while array.size(allLabels) > 0
        label.delete(array.pop(allLabels))

// ════════════════════════════════════════════════════════
// ATR
// ════════════════════════════════════════════════════════
atrVal   = ta.atr(atrLen)
slOffset = atrVal * tfSLMult
longSL   = low  - slOffset
shortSL  = high + slOffset

// ════════════════════════════════════════════════════════
// HEIKIN ASHI — internal only, real OHLC for levels
// ════════════════════════════════════════════════════════
haClose = (open + high + low + close) / 4.0
haOpen  = float(na)
haOpen  := na(haOpen[1]) ? (open + close) / 2.0 : (haOpen[1] + haClose[1]) / 2.0
haHigh  = math.max(high, math.max(haOpen, haClose))
haLow   = math.min(low,  math.min(haOpen, haClose))

haBull        = haClose > haOpen
haBear        = haClose < haOpen
haBodySize    = math.abs(haClose - haOpen)
haAvgBody     = ta.sma(haBodySize, 10)
haBigBull     = haBull and haBodySize > haAvgBody * 1.2
haBigBear     = haBear and haBodySize > haAvgBody * 1.2
haNoUpperWick = (haHigh - math.max(haOpen, haClose)) < haBodySize * 0.1
haNoLowerWick = (math.min(haOpen, haClose) - haLow)   < haBodySize * 0.1
haStrongBear  = haBear and haNoUpperWick
haStrongBull  = haBull and haNoLowerWick
haEngulfBull  = haBull and haClose > haOpen[1] and haOpen < haClose[1]
haEngulfBear  = haBear and haClose < haOpen[1] and haOpen > haClose[1]
haTurnedGreen = haBull and haBear[1]
haTurnedRed   = haBear and haBull[1]

// ════════════════════════════════════════════════════════
// EMA RIBBON
// ════════════════════════════════════════════════════════
ema8  = ta.ema(close, 8)
ema21 = ta.ema(close, 21)
ema50 = ta.ema(close, 50)

bullTrend  = ema8 > ema21 and ema21 > ema50
bearTrend  = ema8 < ema21 and ema21 < ema50
mixedTrend = not bullTrend and not bearTrend

e8  = plot(showEMA and isRTH ? ema8  : na, color=bullTrend ? color.new(color.lime,20)   : bearTrend ? color.new(color.red,20)   : color.new(color.yellow,20), linewidth=1)
e21 = plot(showEMA and isRTH ? ema21 : na, color=bullTrend ? color.new(color.lime,40)   : bearTrend ? color.new(color.red,40)   : color.new(color.yellow,40), linewidth=2)
e50 = plot(showEMA and isRTH ? ema50 : na, color=bullTrend ? color.new(color.lime,60)   : bearTrend ? color.new(color.red,60)   : color.new(color.yellow,60), linewidth=2)
fill(e8,  e21, color=bullTrend ? color.new(color.lime,85)  : bearTrend ? color.new(color.red,85)  : color.new(color.yellow,90))
fill(e21, e50, color=bullTrend ? color.new(color.lime,92)  : bearTrend ? color.new(color.red,92)  : color.new(color.yellow,95))

// ════════════════════════════════════════════════════════
// HTF BIAS
// ════════════════════════════════════════════════════════
htfEma8  = request.security(syminfo.tickerid, htfRes, ta.ema(close, 8),  lookahead=barmerge.lookahead_off)
htfEma21 = request.security(syminfo.tickerid, htfRes, ta.ema(close, 21), lookahead=barmerge.lookahead_off)
htfBull  = htfEma8 > htfEma21
htfBear  = htfEma8 < htfEma21

// ════════════════════════════════════════════════════════
// VWAP — anchored to 9:30am session open
// TradingView's ta.vwap auto-anchors to session when
// chart is set to regular session. For accuracy set
// chart session to "Regular Trading Hours" only.
// ════════════════════════════════════════════════════════
vwapVal  = ta.vwap
vwapStd  = ta.stdev(close, 20)
vwap1up  = vwapVal + vwapStd
vwap2up  = vwapVal + 2.0 * vwapStd
vwap1dn  = vwapVal - vwapStd
vwap2dn  = vwapVal - 2.0 * vwapStd

plot(showVWAP and isRTH ? vwapVal : na, color=color.new(color.white,  0), linewidth=2, title="VWAP")
plot(showVWAP and isRTH ? vwap1up : na, color=color.new(color.aqua,  40), linewidth=1, title="+1σ")
plot(showVWAP and isRTH ? vwap2up : na, color=color.new(color.aqua,  20), linewidth=1, title="+2σ")
plot(showVWAP and isRTH ? vwap1dn : na, color=color.new(color.orange,40), linewidth=1, title="-1σ")
plot(showVWAP and isRTH ? vwap2dn : na, color=color.new(color.orange,20), linewidth=1, title="-2σ")

vwapReclaim = close > vwapVal and close[1] <= vwapVal[1]
aboveVWAP   = close > vwapVal

// ════════════════════════════════════════════════════════
// WVF — Williams VIX Fix (bottom detection)
// ════════════════════════════════════════════════════════
hiClose   = ta.highest(close, pd)
wvf       = (hiClose - low) / hiClose * 100
wvfMid    = ta.sma(wvf, bbl)
wvfUpper  = wvfMid + mult * ta.stdev(wvf, bbl)
hiWvf     = ta.highest(wvf, lb)
wvfBottom = wvf >= wvfUpper or wvf >= hiWvf * ph

// INVERSE VIX (top detection)
loClose  = ta.lowest(close, pd)
ivf_raw  = (loClose - high) / loClose * -100
ivf_min  = ta.lowest(ivf_raw, lb)
ivf_max  = ta.highest(ivf_raw, lb)
ivfRange = ivf_max - ivf_min
ivf_norm = ivfRange > 0 ? ((ivf_raw - ivf_min) / ivfRange) * hiWvf : 0.0
ivfMid   = ta.sma(ivf_norm, bbl)
ivfUpper = ivfMid + mult * ta.stdev(ivf_norm, bbl)
wvfTop   = ivf_norm >= ivfUpper or ivf_norm >= ta.highest(ivf_norm, lb) * ph

// ════════════════════════════════════════════════════════
// VOLUME + RSI
// ════════════════════════════════════════════════════════
avgVol      = ta.sma(volume, 20)
// volSpike threshold adapts by TF — 5min needs 130%, 15min 110%, 65min 103%
tfSpikeThresh = tfMins <= 5  ? volMult : tfMins <= 15 ? math.max(volMult * 0.8, 1.1) : tfMins <= 30 ? math.max(volMult * 0.7, 1.05) : tfMins <= 65 ? math.max(volMult * 0.6, 1.03) : 1.0
volSpike    = volume > avgVol * tfSpikeThresh
// Volume threshold scales with TF — higher TF = lower threshold per bar
tfVolThresh = tfMins <= 5 ? 0.5 : tfMins <= 15 ? 0.3 : tfMins <= 30 ? 0.2 : tfMins <= 65 ? 0.15 : 0.1
aboveAvgVol = volume > avgVol * tfVolThresh
rsiVal      = ta.rsi(close, rsiLen)

// ════════════════════════════════════════════════════════
// INTRADAY VOLUME PROFILE
// POC = price level with highest volume since 9:30am
// VAH/VAL approximated from VWAP ±1σ (already calculated)
// HVN/LVN detected from volume-at-price buckets
// ════════════════════════════════════════════════════════

// Track highest-volume price level since session open
// Uses 20 price buckets spanning today's range
var float pocPrice      = na   // Point of Control
var float pocVol        = 0.0  // volume at POC
var float sessHigh      = na   // session high so far
var float sessLow       = na   // session low so far
var float totalSessVol  = 0.0  // total session volume

// Reset on session open
if isSessionOpen
    pocPrice     := na
    pocVol       := 0.0
    sessHigh     := high
    sessLow      := low
    totalSessVol := 0.0

// Update session high/low and total volume during RTH
if isRTH
    sessHigh     := math.max(nz(sessHigh, high), high)
    sessLow      := math.min(nz(sessLow,  low),  low)
    totalSessVol := totalSessVol + volume

// Simple POC: track price level of highest-volume bar this session
// This is a bar-level POC (most accurate approach in Pine)
var float maxVolBar  = 0.0
var float pocBarPrice = na

if isRTH
    if volume > maxVolBar
        maxVolBar   := volume
        pocBarPrice := (high + low) / 2.0  // midpoint of highest-vol bar

pocPrice := pocBarPrice

// Value Area approximation using session stats
// VAH = VWAP + 1σ (already computed as vwap1up)
// VAL = VWAP - 1σ (already computed as vwap1dn)
// These contain ~68% of traded value — close enough to 70% Value Area

// Price position relative to VP levels
atPOC         = not na(pocPrice) and math.abs(close - pocPrice) <= atrVal * 0.3
abovePOC      = not na(pocPrice) and close > pocPrice
belowPOC      = not na(pocPrice) and close < pocPrice
atVAH         = math.abs(close - vwap1up) <= atrVal * 0.3   // near Value Area High
atVAL         = math.abs(close - vwap1dn) <= atrVal * 0.3   // near Value Area Low
aboveVAH      = close > vwap1up
belowVAL      = close < vwap1dn

// VP-based signal quality boost
// SELL is higher quality when firing at/above VAH (resistance) and price above POC
vpSellConfirm = (atVAH or aboveVAH) and abovePOC
// BUY is higher quality when firing at/below VAL (support) and price below POC  
vpBuyConfirm  = (atVAL or belowVAL) and belowPOC

// Plot POC line — Pine v5 requires line.new() for var line type
var line pocLine = line.new(na, na, na, na, color=color.new(color.yellow,0), width=2)
if isRTH and not na(pocPrice)
    line.set_xy1(pocLine, bar_index - 50, pocPrice)
    line.set_xy2(pocLine, bar_index + 50, pocPrice)
    line.set_color(pocLine, color.new(color.yellow, 0))
    line.set_width(pocLine, 2)

// Reset POC line on new session
if isSessionOpen
    maxVolBar   := 0.0
    pocBarPrice := na
    line.set_xy1(pocLine, bar_index, close)
    line.set_xy2(pocLine, bar_index, close)

// VP quality label on signal labels (added to text in signal section)
vpTag = vpSellConfirm ? " ★VP" : vpBuyConfirm ? " ★VP" : ""


// ════════════════════════════════════════════════════════
// TTM SQUEEZE
// ════════════════════════════════════════════════════════
len20        = 20
smaCl20      = ta.sma(close, len20)
stdCl20      = ta.stdev(close, len20)
bbUpper      = smaCl20 + 2.0 * stdCl20
bbLower      = smaCl20 - 2.0 * stdCl20
atr20        = ta.sma(ta.tr(true), len20)
kcUpper      = smaCl20 + 1.5 * atr20
kcLower      = smaCl20 - 1.5 * atr20
sqzOn        = bbUpper < kcUpper and bbLower > kcLower
squeezeFired = not sqzOn and sqzOn[1]

hiHigh20  = ta.highest(high, len20)
loLow20   = ta.lowest(low,  len20)
ttmMom    = ta.linreg(close - ((hiHigh20 + loLow20) / 2.0 + smaCl20) / 2.0, len20, 0)
momBull   = ttmMom > 0
momBear   = ttmMom < 0
momFlipUp = momBull and not momBull[1]
momFlipDn = momBear and not momBear[1]

// ════════════════════════════════════════════════════════
// CANDLE ANALYSIS — HA for signal logic
// ════════════════════════════════════════════════════════
bullCandle    = haBull
bearCandle    = haBear
closingHigher = haClose > haClose[1]
closingLower  = haClose < haClose[1]
rsiTurningUp  = rsiVal > rsiVal[2]
rsiTurningDn  = rsiVal < rsiVal[2]
bullEngulf    = haEngulfBull
bearEngulf    = haEngulfBear
bigBullBody   = haBigBull
bigBearBody   = haBigBear
higherLow     = low  > low[1]
lowerHigh     = high < high[1]
// For trend continuation: any HA bear/bull candle qualifies
// haStrongBear (no upper wick) is too strict — misses valid trend bars
bearishClose  = haBear
bullishClose  = haBull
// Keep strong versions for WVF reversal signal quality
bearEngulfStrong = haStrongBear and haEngulfBear
bullEngulfStrong = haStrongBull and haEngulfBull

// ════════════════════════════════════════════════════════
// ZONES
// ════════════════════════════════════════════════════════
wvfZoneActive = wvfBottom or wvfBottom[1] or wvfBottom[2] or wvfBottom[3]
wvfTopActive  = wvfTop    or wvfTop[1]    or wvfTop[2]    or wvfTop[3]

// ════════════════════════════════════════════════════════
// EXTENDED TREND — handles gap opens where EMAs lag
// ════════════════════════════════════════════════════════
priceBelow3EMAs = close < ema8  and close < ema21 and close < ema50
priceAbove3EMAs = close > ema8  and close > ema21 and close > ema50
bearTrendExt    = bearTrend or priceBelow3EMAs
bullTrendExt    = bullTrend or priceAbove3EMAs
mixedExt        = not bearTrendExt and not bullTrendExt

// ════════════════════════════════════════════════════════
// FILTERS — only fire signals during RTH
// ════════════════════════════════════════════════════════
// HTF as confidence weight, not hard gate
// Strong local trend (priceBelow/AboveAllEMAs) can override lagging HTF
htfOkBuy    = useHTFBias ? (htfBull or priceAbove3EMAs) : true
htfOkSell   = useHTFBias ? (htfBear or priceBelow3EMAs) : true

// Trend gate: local trend OR HTF agrees
trendOkBuy  = filterMixed ? (bullTrendExt or htfBull) : true
trendOkSell = filterMixed ? (bearTrendExt or htfBear) : true
// VWAP buy filter — relaxed when RSI oversold + WVF bottom active (extreme reversal)
// Normal: price must be above VWAP or just reclaimed it
// Exception: RSI < 35 AND WVF zone active = oversold bounce, allow below VWAP
// VWAP buy filter — bypass when:
// 1. Price above VWAP
// 2. Price just reclaimed VWAP  
// 3. WVF Bottom active (fear spike reversal — VWAP irrelevant here)
// 4. RSI deeply oversold below VWAP (mean reversion setup)
vwapOkBuy   = requireVWAP ? (aboveVWAP or vwapReclaim or wvfZoneActive or rsiVal < rsiOS + 5) : true
sessionOk   = isRTH   // STRICT: no signals outside 9:30-4pm

// ════════════════════════════════════════════════════════
// R:R
// ════════════════════════════════════════════════════════
swingLow   = ta.lowest(low,   10)
swingHigh  = ta.highest(high, 10)
longRange  = math.max(atrVal * 3.0, close - swingLow)
shortRange = math.max(atrVal * 3.0, swingHigh - close)

longT1  = low  + longRange  * 1.0
longT2  = low  + longRange  * 1.618
longT3  = low  + longRange  * 2.618
shortT1 = high - shortRange * 1.0
shortT2 = high - shortRange * 1.618
shortT3 = high - shortRange * 2.618

longRR   = slOffset > 0 ? longRange  / slOffset : 0.0
shortRR  = slOffset > 0 ? shortRange / slOffset : 0.0
rrOkBuy  = longRR  >= tfMinRR
rrOkSell = shortRR >= tfMinRR

// ════════════════════════════════════════════════════════
// TREND CONTINUATION SIGNALS
// ════════════════════════════════════════════════════════
emaBearBreak  = close < ema21 and close[1] >= ema21[1]
momBearEntry  = momFlipDn and close < ema8
trendBearBar  = bearTrendExt and bearishClose and close < ema8 and close < ema21 and close < vwapVal

// Bear thrust: STRONG red bar — needs momentum flip OR EMA cross, not just any red bar
// This prevents firing every single bar in a downtrend
bearThrustBar = bearTrendExt and haStrongBear and close < ema8 and close < ema21 and aboveAvgVol and (momFlipDn or momBear and rsiVal < 50)

// bearContinue: price below all EMAs is strong enough — HTF is a bonus not required
bearContinue  =
     bearTrendExt and (htfOkSell or priceBelow3EMAs) and
     (emaBearBreak or momBearEntry or trendBearBar or bearThrustBar) and
     aboveAvgVol and high < vwapVal and
     rsiVal < 65 and rsiVal > rsiOS and sessionOk

emaBullBreak  = close > ema21 and close[1] <= ema21[1]
momBullEntry  = momFlipUp and close > ema8
trendBullBar  = bullTrendExt and bullishClose and close > ema8 and close > ema21 and close > vwapVal

bullContinue  =
     bullTrendExt and (htfOkBuy or priceAbove3EMAs) and
     (emaBullBreak or momBullEntry or trendBullBar) and
     aboveAvgVol and aboveVWAP and
     rsiVal > rsiOS and rsiVal < rsiOB and sessionOk

// ════════════════════════════════════════════════════════
// SIGNAL TIERS
// ════════════════════════════════════════════════════════
// On higher TF, accept above-average volume (not just spike)
tfVolOkBuy  = tfMins <= 5 ? volSpike : (volSpike or aboveAvgVol)
tfVolOkSell = tfMins <= 5 ? volSpike : (volSpike or aboveAvgVol)

perfectBuy =
     wvfZoneActive and (bullEngulf or bigBullBody) and
     (momFlipUp or squeezeFired) and tfVolOkBuy and
     rsiVal < rsiOB and trendOkBuy and htfOkBuy and vwapOkBuy and sessionOk

strongBuy =
     wvfZoneActive and bullCandle and closingHigher and
     (rsiTurningUp or momBull) and rsiVal < rsiOB and
     trendOkBuy and htfOkBuy and vwapOkBuy and not perfectBuy and sessionOk

confirmedBuy =
     wvfZoneActive and bullCandle and higherLow and
     trendOkBuy and htfOkBuy and
     not strongBuy and not perfectBuy and sessionOk

perfectSell =
     wvfTopActive and (bearEngulf or bigBearBody) and
     (momFlipDn or squeezeFired) and tfVolOkSell and
     rsiVal > rsiOS and trendOkSell and htfOkSell and sessionOk

strongSell =
     wvfTopActive and bearCandle and closingLower and
     (rsiTurningDn or momBear) and rsiVal > rsiOS and
     trendOkSell and htfOkSell and not perfectSell and sessionOk

confirmedSell =
     wvfTopActive and bearCandle and lowerHigh and
     trendOkSell and htfOkSell and
     not strongSell and not perfectSell and sessionOk

// ════════════════════════════════════════════════════════
// SESSION-SCOPED STATE — ALL reset at 9:30am
// ════════════════════════════════════════════════════════
var int   lastBuyBar   = 0
var int   lastSellBar  = 0
var float savedBuySL   = na
var float savedSellSL  = na
var float lastLongT1   = na
var float lastLongT2   = na
var float lastShortT1  = na
var float lastShortT2  = na
var bool  longTgtHit   = false
var bool  shortTgtHit  = false

// P&L tracking
var float entryPrice        = na
var bool  inLong            = false
var bool  inShort           = false
var int   lastTrendSellBar  = 0
var int   lastTrendBuyBar   = 0
var bool  t1Long       = false
var bool  t1Short      = false
var bool  t2Long       = false
var bool  t2Short      = false
var float sessPnL      = 0.0
var int   sessWins     = 0
var int   sessLosses   = 0
var int   sessTrades   = 0
var float bestTrade    = 0.0
var float worstTrade   = 0.0


// ── FULL RESET AT 9:30am ──
if isSessionOpen
    // Clear all lines from previous session
    f_clear_all()
    // Reset all state
    lastBuyBar    := 0
    lastSellBar   := 0
    savedBuySL    := na
    savedSellSL   := na
    lastLongT1    := na
    lastLongT2    := na
    lastShortT1   := na
    lastShortT2   := na
    longTgtHit    := false
    shortTgtHit   := false
    entryPrice    := na
    inLong        := false
    inShort       := false
    t1Long        := false
    t1Short       := false
    t2Long        := false
    t2Short       := false
    sessPnL       := 0.0
    sessWins      := 0
    sessLosses    := 0
    sessTrades    := 0
    bestTrade     := 0.0
    worstTrade    := 0.0
    buyCount          := 0
    sellCount         := 0
    lastTrendSellBar  := 0
    lastTrendBuyBar   := 0

// ════════════════════════════════════════════════════════
// COOLDOWN — 12 bars minimum between signals
// ════════════════════════════════════════════════════════
buySLBreached  = not na(savedBuySL)  and low  < savedBuySL  and bar_index > lastBuyBar
sellSLBreached = not na(savedSellSL) and high > savedSellSL and bar_index > lastSellBar

if buySLBreached
    savedBuySL := na
    f_clear_all()
if sellSLBreached
    savedSellSL := na
    f_clear_all()

barsSinceBuy  = bar_index - lastBuyBar
barsSinceSell = bar_index - lastSellBar

// Trend re-entry: faster cooldown when strong trend established
// Strong trend = price below/above all 3 EMAs
strongBearTrend = priceBelow3EMAs and bearTrend
strongBullTrend = priceAbove3EMAs and bullTrend

// Cooldown tiers:
// - Trend completed (T2 hit): 3 bars = 15 min re-entry
// - T1 hit (runner exited): 5 bars = 25 min re-entry
// - Strong trend day: halved cooldown for faster re-entries
// - Normal: full tfCooldown
trendCooldown = strongBearTrend or strongBullTrend ? math.max(tfCooldown / 2, 3) : tfCooldown

buyReady  = buySLBreached or
     (longTgtHit  and t2Long  and barsSinceBuy  > 3) or
     (longTgtHit  and barsSinceBuy  > 5) or
     barsSinceBuy  > trendCooldown

sellReady = sellSLBreached or
     (shortTgtHit and t2Short and barsSinceSell > 3) or
     (shortTgtHit and barsSinceSell > 5) or
     barsSinceSell > trendCooldown

// ════════════════════════════════════════════════════════
// DEDUPLICATION + R:R GATE
// ════════════════════════════════════════════════════════
showPerfectBuy    = perfectBuy    and buyReady  and rrOkBuy
showStrongBuy     = strongBuy     and buyReady  and not perfectBuy   and rrOkBuy
showConfirmedBuy  = confirmedBuy  and buyReady  and not perfectBuy   and not strongBuy  and rrOkBuy
showPerfectSell   = perfectSell   and sellReady and rrOkSell
showStrongSell    = strongSell    and sellReady and not perfectSell  and rrOkSell
showConfirmedSell = confirmedSell and sellReady and not perfectSell  and not strongSell and rrOkSell
// Trend continuation: separate cooldown — min 8 bars between trend signals
trendSellReady = (bar_index - lastTrendSellBar) > 8
trendBuyReady  = (bar_index - lastTrendBuyBar)  > 8

showBearCont      = bearContinue  and sellReady and rrOkSell and trendSellReady
showBullCont      = bullContinue  and buyReady  and rrOkBuy  and trendBuyReady

// Update trend signal bar trackers AFTER show flags computed
if showBearCont
    lastTrendSellBar := bar_index
if showBullCont
    lastTrendBuyBar  := bar_index

anyBuy  = showPerfectBuy  or showStrongBuy  or showConfirmedBuy  or showBullCont
anySell = showPerfectSell or showStrongSell or showConfirmedSell or showBearCont

// Record entry
if anyBuy
    lastBuyBar  := bar_index
    savedBuySL  := low - slOffset
    lastLongT1  := low + longRange * 1.0
    lastLongT2  := low + longRange * 1.618
    longTgtHit  := false
    entryPrice  := close
    inLong      := true
    inShort     := false
    t1Long      := false

if anySell
    lastSellBar := bar_index
    savedSellSL := high + slOffset
    lastShortT1 := high - shortRange * 1.0
    lastShortT2 := high - shortRange * 1.618
    shortTgtHit := false
    entryPrice  := close
    inShort     := true
    inLong      := false
    t1Short     := false

// ════════════════════════════════════════════════════════
// CHANDELIER EXIT — Trailing stop
// ════════════════════════════════════════════════════════
chanLen       = 22
chanLongStop  = ta.highest(high, chanLen) - atrVal * chanMult
chanShortStop = ta.lowest(low,   chanLen) + atrVal * chanMult

// Only show chandelier when in a trade
plot(showChan and inLong  and isRTH ? chanLongStop  : na,
     title="Chan Long",  color=color.new(color.lime,30), linewidth=1, style=plot.style_circles)
plot(showChan and inShort and isRTH ? chanShortStop : na,
     title="Chan Short", color=color.new(color.red, 30), linewidth=1, style=plot.style_circles)

// RSI divergence
rsiHighPrev   = ta.highest(rsiVal, 5)[1]
rsiLowPrev    = ta.lowest(rsiVal,  5)[1]
priceHighPrev = ta.highest(high,   5)[1]
priceLowPrev  = ta.lowest(low,     5)[1]
bearDiv       = inLong  and high > priceHighPrev and rsiVal < rsiHighPrev and rsiVal > 50
bullDiv       = inShort and low  < priceLowPrev  and rsiVal > rsiLowPrev  and rsiVal < 50

plotshape(bearDiv, title="Bear Div", location=location.abovebar,
     style=shape.triangledown, color=color.new(color.orange,0), size=size.tiny)
plotshape(bullDiv, title="Bull Div", location=location.belowbar,
     style=shape.triangleup,  color=color.new(color.orange,0), size=size.tiny)

// Exit conditions — minimum 3 bars after entry
minBarsLong  = (bar_index - lastBuyBar)  > tfMinEntry
minBarsShort = (bar_index - lastSellBar) > tfMinEntry

// WVF opposing exit: fires anytime after min bars (full position)
wvfExitLong   = inLong  and wvfTopActive  and minBarsLong
wvfExitShort  = inShort and wvfZoneActive and minBarsShort

// Chandelier exit: ONLY activates after T1 is hit (runner management)
// Before T1: SL manages the trade. After T1: chandelier trails the runner
chanExitLong  = inLong  and t1Long  and low  < chanLongStop  and minBarsLong
chanExitShort = inShort and t1Short and high > chanShortStop and minBarsShort

exitLong  = inLong  and not na(entryPrice) and (wvfExitLong  or chanExitLong)
exitShort = inShort and not na(entryPrice) and (wvfExitShort or chanExitShort)

exitLongReason  = wvfExitLong  ? "WVF.T" : "C.EXIT"
exitShortReason = wvfExitShort ? "WVF.B" : "C.EXIT"

// ════════════════════════════════════════════════════════
// P&L LABELS
// ════════════════════════════════════════════════════════
f_pnl(pts, isWin, ypos, above, reason) =>
    col   = isWin ? color.new(color.lime,10) : color.new(color.red,20)
    sty   = above  ? label.style_label_down  : label.style_label_up
    ptsStr = (pts >= 0 ? "+" : "") + str.tostring(pts,"#.#") + "p"
    if histMode
        // Circle with P&L inside — green for profit, red for loss
        label.new(bar_index, ypos,
             text=ptsStr,
             style=label.style_circle, color=col, textcolor=color.white, size=size.small)
    else
        label.new(bar_index, ypos,
             text=(isWin ? "✅ " : "❌ ") + reason + "\n" + ptsStr,
             style=sty, color=col, textcolor=color.white, size=size.small)

// T1 partial exit
if inLong and not na(lastLongT1) and high >= lastLongT1 and not t1Long and (bar_index - lastBuyBar) > 1
    t1Long    := true
    longTgtHit := true
    pts = lastLongT1 - entryPrice
    sessPnL    := sessPnL + pts * 0.7   // 70% size partial P&L
    entryPrice := lastLongT1             // runner P&L from T1
    if not cleanMode or barstate.islast
        if histMode
            label.new(bar_index, high + atrVal * 0.5,
                 text="T1", style=label.style_circle,
                 color=color.new(color.yellow,20), textcolor=color.black, size=size.tiny)
        else
            label.new(bar_index, high + atrVal * 0.6,
                 text="T1 ✅ +" + str.tostring(pts,"#.#") + "p (70%)",
                 style=label.style_label_down, color=color.new(color.yellow,20),
                 textcolor=color.black, size=size.small)

if inShort and not na(lastShortT1) and low <= lastShortT1 and not t1Short and (bar_index - lastSellBar) > 1
    t1Short    := true
    shortTgtHit := true
    pts = entryPrice - lastShortT1
    sessPnL    := sessPnL + pts * 0.7   // 70% size partial P&L
    // Move virtual entry to T1 level — runner P&L now calculated from here
    entryPrice := lastShortT1
    if not cleanMode or barstate.islast
        if histMode
            label.new(bar_index, low - atrVal * 0.5,
                 text="T1", style=label.style_circle,
                 color=color.new(color.yellow,20), textcolor=color.black, size=size.tiny)
        else
            label.new(bar_index, low - atrVal * 0.6,
                 text="T1 ✅ +" + str.tostring(pts,"#.#") + "p (70%)",
                 style=label.style_label_up, color=color.new(color.yellow,20),
                 textcolor=color.black, size=size.small)

// T2 partial exit
if inLong and not na(lastLongT2) and high >= lastLongT2 and (bar_index - lastBuyBar) > 1
    pts = lastLongT2 - entryPrice
    sessPnL    := sessPnL + pts * 0.2
    entryPrice := lastLongT2
    t2Long     := true
    if histMode
        label.new(bar_index, high + atrVal * 0.7,
             text="T2", style=label.style_circle,
             color=color.new(color.aqua,20), textcolor=color.black, size=size.tiny)
    else
        label.new(bar_index, high + atrVal * 0.9,
             text="T2 ✅ +" + str.tostring(pts,"#.#") + "p (20%)",
             style=label.style_label_down, color=color.new(color.aqua,20),
             textcolor=color.black, size=size.small)

if inShort and not na(lastShortT2) and low <= lastShortT2 and (bar_index - lastSellBar) > 1
    pts = entryPrice - lastShortT2
    sessPnL    := sessPnL + pts * 0.2
    entryPrice := lastShortT2
    t2Short    := true
    if histMode
        label.new(bar_index, low - atrVal * 0.7,
             text="T2", style=label.style_circle,
             color=color.new(color.aqua,20), textcolor=color.black, size=size.tiny)
    else
        label.new(bar_index, low - atrVal * 0.9,
             text="T2 ✅ +" + str.tostring(pts,"#.#") + "p (20%)",
             style=label.style_label_up, color=color.new(color.aqua,20),
             textcolor=color.black, size=size.small)

// RSI divergence warning
if bearDiv and not cleanMode
    if histMode
        label.new(bar_index, high + atrVal * 1.5,
             text="!", style=label.style_circle,
             color=color.new(color.yellow,10), textcolor=color.black, size=size.tiny)
    else
        label.new(bar_index, high + atrVal * 2.5,
             text="⚠BDIV\nTighten",
             style=label.style_label_down, color=color.new(color.orange,20),
             textcolor=color.white, size=size.small)
if bullDiv and not cleanMode
    if histMode
        label.new(bar_index, low - atrVal * 1.5,
             text="!", style=label.style_circle,
             color=color.new(color.yellow,10), textcolor=color.black, size=size.tiny)
    else
        label.new(bar_index, low - atrVal * 2.5,
             text="⚠BDIV\nTighten",
             style=label.style_label_up, color=color.new(color.orange,20),
             textcolor=color.white, size=size.small)

// ════════════════════════════════════════════════════════
// FORCED EXIT AT 3:55pm — no overnight carries on intraday
// ════════════════════════════════════════════════════════
isForceClose = etTime >= 1555 and etTime < 1600  // 3:55-4:00pm window
isSessionEnd = ta.change(isAfterMkt ? 1 : 0) > 0 and isAfterMkt  // first bar after 4pm

// Force close any open position at 3:55pm
if isForceClose and inLong and not na(entryPrice)
    pts   = close - entryPrice
    isWin = pts > 0
    f_pnl(pts, isWin, low - atrVal * 1.2, false, "EOD")
    sessPnL    := sessPnL + pts * (t1Long ? (t2Long ? 0.1 : 0.3) : 1.0)
    if isWin
        sessWins  := sessWins + 1
        bestTrade := math.max(bestTrade, pts)
    else
        sessLosses := sessLosses + 1
        worstTrade := math.min(worstTrade, pts)
    sessTrades := sessTrades + 1
    inLong     := false
    entryPrice := na

if isForceClose and inShort and not na(entryPrice)
    pts   = entryPrice - close
    isWin = pts > 0
    f_pnl(pts, isWin, high + atrVal * 1.2, true, "EOD")
    sessPnL    := sessPnL + pts * (t1Short ? (t2Short ? 0.1 : 0.3) : 1.0)
    if isWin
        sessWins  := sessWins + 1
        bestTrade := math.max(bestTrade, pts)
    else
        sessLosses := sessLosses + 1
        worstTrade := math.min(worstTrade, pts)
    sessTrades := sessTrades + 1
    inShort    := false
    entryPrice := na

// Clear all lines at 4:00pm session end
if isSessionEnd
    f_clear_all()

// SL hit — only before T1 (after T1, chandelier manages it)
if inLong and not na(savedBuySL) and low < savedBuySL and not t1Long and (bar_index - lastBuyBar) > 1
    pts = savedBuySL - entryPrice
    f_pnl(pts, false, low - atrVal * 1.2, false, "SL")
    sessPnL    := sessPnL + pts
    sessLosses := sessLosses + 1
    sessTrades := sessTrades + 1
    worstTrade := math.min(worstTrade, pts)
    inLong     := false
    entryPrice := na

if inShort and not na(savedSellSL) and high > savedSellSL and not t1Short and (bar_index - lastSellBar) > 1
    pts = entryPrice - savedSellSL
    f_pnl(pts, false, high + atrVal * 1.2, true, "SL")
    sessPnL    := sessPnL + pts
    sessLosses := sessLosses + 1
    sessTrades := sessTrades + 1
    worstTrade := math.min(worstTrade, pts)
    inShort    := false
    entryPrice := na

// Chandelier / WVF exit
if exitLong
    pts   = close - entryPrice
    isWin = pts > 0
    f_pnl(pts, isWin, low - atrVal * 1.2, false, exitLongReason + " 10%R")
    sessPnL    := sessPnL + pts * 0.1   // 10% runner exit
    if isWin
        sessWins   := sessWins + 1
        bestTrade  := math.max(bestTrade, pts)
    else
        sessLosses := sessLosses + 1
        worstTrade := math.min(worstTrade, pts)
    sessTrades := sessTrades + 1
    inLong     := false
    entryPrice := na

if exitShort
    pts   = entryPrice - close
    isWin = pts > 0
    f_pnl(pts, isWin, high + atrVal * 1.2, true, exitShortReason + " 10%R")
    sessPnL    := sessPnL + pts * 0.1   // 10% runner exit
    if isWin
        sessWins   := sessWins + 1
        bestTrade  := math.max(bestTrade, pts)
    else
        sessLosses := sessLosses + 1
        worstTrade := math.min(worstTrade, pts)
    sessTrades := sessTrades + 1
    inShort    := false
    entryPrice := na

// ════════════════════════════════════════════════════════
// SIGNAL LABELS
// ════════════════════════════════════════════════════════
// histMode: small circle with strength number inside
//   - green circle below bar = buy (darker = stronger)
//   - red circle above bar = sell
// Current bar (barstate.islast or real-time): full text label
// ════════════════════════════════════════════════════════

var int  lastSignalBar = 0
if anyBuy or anySell
    lastSignalBar := bar_index

// isHistBar: true for ALL bars except the very last bar on chart
// This is the reliable Pine way — barstate.islast = only the rightmost bar
isHistBar = histMode and not barstate.islast

// Strength → opacity mapping (lower opacity = more color = stronger)
// Arrow label helpers for historical signals
// style_label_up   = arrow pointing UP   (buy  — below candle, pointing into it)
// style_label_down = arrow pointing DOWN (sell — above candle, pointing into it)
f_buyArrow(strength, rr, opac) =>
    label.new(bar_index, low - atrVal * 0.3,
         text=str.tostring(strength) + "/" + str.tostring(rr,"#.#") + "R",
         style=label.style_label_up,
         color=color.new(color.green, opac),
         textcolor=color.white,
         size=size.small)

f_sellArrow(strength, rr, opac) =>
    label.new(bar_index, high + atrVal * 0.3,
         text=str.tostring(strength) + "/" + str.tostring(rr,"#.#") + "R",
         style=label.style_label_down,
         color=color.new(color.red, opac),
         textcolor=color.white,
         size=size.small)

// ── HISTORICAL BARS: arrow label with strength/RR ──
// Arrow points INTO the candle (buy=up arrow below, sell=down arrow above)
// Opacity: 8=10% (vivid), 6=25%, 4=45%, 2=70% (faint)
if isHistBar
    if showPerfectBuy
        buyCount  := buyCount + 1
        f_buyArrow(8, longRR, 10)
    else if showStrongBuy
        buyCount  := buyCount + 1
        f_buyArrow(4, longRR, 45)
    else if showConfirmedBuy
        buyCount  := buyCount + 1
        f_buyArrow(2, longRR, 70)
    else if showBullCont
        buyCount  := buyCount + 1
        f_buyArrow(6, longRR, 25)

    if showPerfectSell
        sellCount := sellCount + 1
        f_sellArrow(8, shortRR, 10)
    else if showStrongSell
        sellCount := sellCount + 1
        f_sellArrow(4, shortRR, 45)
    else if showConfirmedSell
        sellCount := sellCount + 1
        f_sellArrow(2, shortRR, 70)
    else if showBearCont
        sellCount := sellCount + 1
        f_sellArrow(6, shortRR, 25)

// ── CURRENT/LIVE BAR: full text label ──
if not isHistBar
    if showPerfectBuy
        buyCount  := buyCount + 1
        label.new(bar_index, low - atrVal * 1.2,
             text="★B#" + str.tostring(buyCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(longRR,"#.#") + "R",
             style=label.style_label_up, color=color.lime, textcolor=color.black, size=size.small)
    else if showStrongBuy
        buyCount  := buyCount + 1
        label.new(bar_index, low - atrVal * 1.2,
             text="S.B#" + str.tostring(buyCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(longRR,"#.#") + "R",
             style=label.style_label_up, color=color.green, textcolor=color.white, size=size.small)
    else if showConfirmedBuy
        buyCount  := buyCount + 1
        label.new(bar_index, low - atrVal * 1.2,
             text="B#" + str.tostring(buyCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(longRR,"#.#") + "R",
             style=label.style_label_up, color=color.teal, textcolor=color.white, size=size.small)
    else if showBullCont
        buyCount  := buyCount + 1
        label.new(bar_index, low - atrVal * 1.2,
             text="T.B#" + str.tostring(buyCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(longRR,"#.#") + "R",
             style=label.style_label_up, color=color.new(color.blue,0), textcolor=color.white, size=size.small)

    if showPerfectSell
        sellCount := sellCount + 1
        label.new(bar_index, high + atrVal * 1.2,
             text="★S#" + str.tostring(sellCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(shortRR,"#.#") + "R",
             style=label.style_label_down, color=color.red, textcolor=color.white, size=size.small)
    else if showStrongSell
        sellCount := sellCount + 1
        label.new(bar_index, high + atrVal * 1.2,
             text="S.S#" + str.tostring(sellCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(shortRR,"#.#") + "R",
             style=label.style_label_down, color=color.orange, textcolor=color.white, size=size.small)
    else if showConfirmedSell
        sellCount := sellCount + 1
        label.new(bar_index, high + atrVal * 1.2,
             text="S#" + str.tostring(sellCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(shortRR,"#.#") + "R",
             style=label.style_label_down, color=color.maroon, textcolor=color.white, size=size.small)
    else if showBearCont
        sellCount := sellCount + 1
        label.new(bar_index, high + atrVal * 1.2,
             text="T.S#" + str.tostring(sellCount) + vpTag + "\n@" + str.tostring(close,"#.##") + "  " + str.tostring(shortRR,"#.#") + "R",
             style=label.style_label_down, color=color.new(color.purple,0), textcolor=color.white, size=size.small)

// SL + TARGET LINES (current signal only)
// ════════════════════════════════════════════════════════
if anyBuy or anySell
    f_clear_all()
    lx1 = bar_index
    lx2 = bar_index + fwdBars
    lbl = bar_index + 1

    if anyBuy
        if showSL
            array.push(allLines,  line.new(lx1, longSL, lx2, longSL, color=color.new(color.red,10), width=1, style=line.style_dashed))
            array.push(allLabels, label.new(lbl+3, longSL, text="SL " + str.tostring(longSL,"#.##"), style=label.style_label_left, color=color.new(color.red,20), textcolor=color.white, size=size.small))
        if showTgts
            array.push(allLines,  line.new(lx1, longT1, lx2, longT1, color=color.new(color.yellow,10), width=2))
            array.push(allLabels, label.new(lbl, longT1, text="T1  " + str.tostring(longT1,"#.##"), style=label.style_label_right, color=color.new(color.yellow,20), textcolor=color.black, size=size.small))
            array.push(allLines,  line.new(lx1, longT2, lx2, longT2, color=color.new(color.aqua,10), width=1))
            array.push(allLabels, label.new(lbl, longT2, text="T2  " + str.tostring(longT2,"#.##"), style=label.style_label_right, color=color.new(color.aqua,20), textcolor=color.black, size=size.small))
            array.push(allLines,  line.new(lx1, longT3, lx2, longT3, color=color.new(color.lime,10), width=1))
            array.push(allLabels, label.new(lbl, longT3, text="T3  " + str.tostring(longT3,"#.##"), style=label.style_label_right, color=color.new(color.lime,20), textcolor=color.black, size=size.small))

    if anySell
        if showSL
            array.push(allLines,  line.new(lx1, shortSL, lx2, shortSL, color=color.new(color.red,10), width=1, style=line.style_dashed))
            array.push(allLabels, label.new(lbl+3, shortSL, text="SL " + str.tostring(shortSL,"#.##"), style=label.style_label_left, color=color.new(color.red,20), textcolor=color.white, size=size.small))
        if showTgts
            array.push(allLines,  line.new(lx1, shortT1, lx2, shortT1, color=color.new(color.yellow,10), width=2))
            array.push(allLabels, label.new(lbl, shortT1, text="T1  " + str.tostring(shortT1,"#.##"), style=label.style_label_right, color=color.new(color.yellow,20), textcolor=color.black, size=size.small))
            array.push(allLines,  line.new(lx1, shortT2, lx2, shortT2, color=color.new(color.aqua,10), width=1))
            array.push(allLabels, label.new(lbl, shortT2, text="T2  " + str.tostring(shortT2,"#.##"), style=label.style_label_right, color=color.new(color.aqua,20), textcolor=color.black, size=size.small))
            array.push(allLines,  line.new(lx1, shortT3, lx2, shortT3, color=color.new(color.lime,10), width=1))
            array.push(allLabels, label.new(lbl, shortT3, text="T3  " + str.tostring(shortT3,"#.##"), style=label.style_label_right, color=color.new(color.lime,20), textcolor=color.black, size=size.small))

// ════════════════════════════════════════════════════════
// BACKGROUNDS
// ════════════════════════════════════════════════════════
bgcolor(not isRTH      ? color.new(color.gray,   97) : na)  // non-RTH = dark gray
bgcolor(isOpeningRange ? color.new(color.yellow, 93) : na)  // opening range = yellow highlight
bgcolor(isRTH and bullTrend  ? color.new(color.lime,   97) : na)
bgcolor(isRTH and bearTrend  ? color.new(color.red,    97) : na)
bgcolor(isRTH and mixedTrend ? color.new(color.yellow, 97) : na)
bgcolor(isRTH and sqzOn      ? color.new(color.purple, 96) : na)

// ════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════
var table dash = table.new(position.top_right, 2, 25,
     bgcolor=color.new(color.black,70), border_width=1,
     border_color=color.new(color.gray,50))

okCol  = color.new(color.lime,  10)
noCol  = color.new(color.red,   20)
naCol  = color.new(color.gray,  40)
hdrCol = color.new(color.white,  0)
navCol = color.new(color.navy,  30)
wrnCol = color.new(color.orange,20)

f_bool(c) => c ? "✓" : "✗"
f_col(c)  => c ? okCol : noCol

if showDash and barstate.islast
    // Header
    sessLabel = isRTH ? "RTH " + tfLabel : isPreMarket ? "PRE-MKT" : "AFTER HRS"
    sessHdrC  = isRTH ? okCol : wrnCol
    table.cell(dash,0,0,"SPX INTRADAY",  text_color=hdrCol, text_size=size.small, bgcolor=navCol)
    table.cell(dash,1,0,sessLabel,       text_color=hdrCol, text_size=size.small, bgcolor=sessHdrC)

    trendStr = bullTrendExt ? "BULL" : bearTrendExt ? "BEAR" : "MIXED"
    trendC   = bullTrend ? okCol : bearTrend ? noCol : color.new(color.yellow,20)
    table.cell(dash,0,1,"Trend (EMA)",   text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,1,trendStr,        text_color=hdrCol, text_size=size.small, bgcolor=trendC)

    htfOverride = priceBelow3EMAs or priceAbove3EMAs
    htfStr = (htfBull ? "BULL" : "BEAR") + " (" + htfRes + ")" + (htfOverride ? " OVR" : "")
    htfC   = htfBull ? okCol : noCol
    table.cell(dash,0,2,"HTF Bias",      text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,2,htfStr,          text_color=hdrCol, text_size=size.small, bgcolor=htfOverride ? wrnCol : htfC)

    table.cell(dash,0,3,"WVF Bottom",    text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,3,f_bool(wvfZoneActive), text_color=hdrCol, text_size=size.small, bgcolor=f_col(wvfZoneActive))

    table.cell(dash,0,4,"WVF Top",       text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,4,f_bool(wvfTopActive),  text_color=hdrCol, text_size=size.small, bgcolor=f_col(wvfTopActive))

    volPct = str.tostring(math.round(volume / avgVol * 100)) + "%"
    table.cell(dash,0,5,"Vol Spike",     text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,5,f_bool(volSpike) + " " + volPct + " (>" + str.tostring(math.round(tfSpikeThresh*100)) + "%)", text_color=hdrCol, text_size=size.small, bgcolor=volSpike ? okCol : aboveAvgVol ? wrnCol : noCol)

    rsiC = rsiVal < rsiOS ? okCol : rsiVal > rsiOB ? noCol : naCol
    table.cell(dash,0,6,"RSI",           text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,6,str.tostring(math.round(rsiVal)), text_color=hdrCol, text_size=size.small, bgcolor=rsiC)

    sqzStr = sqzOn ? "LOADING..." : squeezeFired ? "FIRED!" : "OFF"
    sqzC   = squeezeFired ? okCol : sqzOn ? color.new(color.purple,20) : naCol
    table.cell(dash,0,7,"Squeeze",       text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,7,sqzStr,          text_color=hdrCol, text_size=size.small, bgcolor=sqzC)

    momStr = momFlipUp ? "FLIP UP" : momFlipDn ? "FLIP DN" : momBull ? "BULL" : "BEAR"
    table.cell(dash,0,8,"Momentum",      text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,8,momStr,          text_color=hdrCol, text_size=size.small, bgcolor=f_col(momBull))

    vwapStr = aboveVWAP ? "ABOVE" : "BELOW"
    table.cell(dash,0,9,"VWAP",          text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,9,vwapStr,         text_color=hdrCol, text_size=size.small, bgcolor=f_col(aboveVWAP))

    // Volume Profile rows
    pocStr = not na(pocPrice) ? str.tostring(pocPrice,"#.##") : "Building..."
    pocC   = atPOC ? color.new(color.yellow,20) : abovePOC ? okCol : noCol
    table.cell(dash,0,13,"POC",           text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,13,pocStr,          text_color=hdrCol, text_size=size.small, bgcolor=pocC)

    vaStr = aboveVAH ? "ABOVE VAH" : belowVAL ? "BELOW VAL" : atVAH ? "AT VAH" : atVAL ? "AT VAL" : "Inside VA"
    vaC   = (atVAH or aboveVAH) ? noCol : (atVAL or belowVAL) ? okCol : naCol
    table.cell(dash,0,14,"Value Area",    text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,14,vaStr,           text_color=hdrCol, text_size=size.small, bgcolor=vaC)

    vpQual = vpSellConfirm ? "SELL ZONE ★" : vpBuyConfirm ? "BUY ZONE ★" : "Neutral"
    vpQualC = vpSellConfirm ? noCol : vpBuyConfirm ? okCol : naCol
    table.cell(dash,0,15,"VP Quality",    text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,15,vpQual,          text_color=hdrCol, text_size=size.small, bgcolor=vpQualC)


    eodC = isForceClose ? noCol : isRTH and etTime >= 1500 ? wrnCol : naCol
    cdActive = strongBearTrend or strongBullTrend
    cdStr = cdActive ? str.tostring(math.round(trendCooldown)) + "bars★" : str.tostring(tfCooldown) + "bars"
    eodStr = isForceClose ? "FORCE CLOSE!" : str.tostring(atrVal,"#.##") + " / " + tfLabel + " " + cdStr
    table.cell(dash,0,10,"ATR / TF",      text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,10,eodStr,          text_color=hdrCol, text_size=size.small, bgcolor=cdActive ? wrnCol : eodC)

    table.cell(dash,0,11,"R:R (Long)",   text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,11,str.tostring(longRR,"#.##") + "x", text_color=hdrCol, text_size=size.small, bgcolor=f_col(rrOkBuy))

    table.cell(dash,0,12,"R:R (Short)",  text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,12,str.tostring(shortRR,"#.##") + "x", text_color=hdrCol, text_size=size.small, bgcolor=f_col(rrOkSell))

    blockedStr = ""
    blockedC   = naCol
    if not anyBuy and not anySell and isRTH
        blockedC := wrnCol
        if not sessionOk
            blockedStr := "Outside RTH"
        else if not htfOkBuy and not htfOkSell
            blockedStr := "HTF wrong side"
        else if not rrOkBuy and not rrOkSell
            blockedStr := "R:R too low"
        else if not aboveAvgVol
            blockedStr := "Low vol (" + str.tostring(math.round(volume/avgVol*100)) + "% < " + str.tostring(math.round(tfVolThresh*100)) + "% min)"
        else if mixedExt and filterMixed
            blockedStr := "Mixed trend"
        else if not vwapOkBuy and (wvfZoneActive or bullTrendExt)
            blockedStr := "Below VWAP (no WVF zone)"
        else
            blockedStr := "Candle confirm"
    else if not isRTH
        blockedStr := "Outside RTH"
        blockedC   := wrnCol
    else
        blockedStr := "SIGNAL ACTIVE"
        blockedC   := okCol

    table.cell(dash,0,16,"Blocked by",   text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,16,blockedStr,     text_color=hdrCol, text_size=size.small, bgcolor=blockedC)

    sigStr = showPerfectBuy ? "★ PERFECT BUY" : showStrongBuy ? "STRONG BUY" : showConfirmedBuy ? "CONFIRMED BUY" : showBullCont ? "TREND BUY" : showPerfectSell ? "★ PERFECT SELL" : showStrongSell ? "STRONG SELL" : showConfirmedSell ? "CONFIRMED SELL" : showBearCont ? "TREND SELL" : "NO SIGNAL"
    sigC   = anyBuy ? okCol : anySell ? noCol : naCol
    table.cell(dash,0,17,"SIGNAL",       text_color=hdrCol, text_size=size.small, bgcolor=navCol)
    table.cell(dash,1,17,sigStr,         text_color=hdrCol, text_size=size.small, bgcolor=sigC)

    // P&L section
    pnlC = sessPnL >= 0 ? okCol : noCol
    table.cell(dash,0,18,"── P&L ──",   text_color=hdrCol, text_size=size.small, bgcolor=navCol)
    table.cell(dash,1,18,"Today",        text_color=hdrCol, text_size=size.small, bgcolor=navCol)

    table.cell(dash,0,19,"Session P&L",  text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,19,(sessPnL >= 0 ? "+" : "") + str.tostring(sessPnL,"#.##") + " pts", text_color=hdrCol, text_size=size.small, bgcolor=pnlC)

    table.cell(dash,0,20,"Trades",       text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,20,str.tostring(sessTrades) + "  (" + str.tostring(sessWins) + "W / " + str.tostring(sessLosses) + "L)", text_color=hdrCol, text_size=size.small, bgcolor=naCol)

    winRate = sessTrades > 0 ? math.round((sessWins / sessTrades) * 100) : 0
    table.cell(dash,0,21,"Win Rate",     text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,21,str.tostring(winRate) + "%", text_color=hdrCol, text_size=size.small, bgcolor=winRate >= 50 ? okCol : noCol)

    table.cell(dash,0,22,"Best Trade",   text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,22,"+" + str.tostring(bestTrade,"#.##") + " pts", text_color=hdrCol, text_size=size.small, bgcolor=okCol)

    table.cell(dash,0,23,"Worst Trade",  text_color=hdrCol, text_size=size.small)
    table.cell(dash,1,23,str.tostring(worstTrade,"#.##") + " pts", text_color=hdrCol, text_size=size.small, bgcolor=noCol)

    posStr = inLong ? "LONG @ " + str.tostring(entryPrice,"#.##") : inShort ? "SHORT @ " + str.tostring(entryPrice,"#.##") : "FLAT"
    posC   = inLong ? okCol : inShort ? noCol : naCol
    table.cell(dash,0,24,"Position",     text_color=hdrCol, text_size=size.small, bgcolor=navCol)
    table.cell(dash,1,24,posStr,         text_color=hdrCol, text_size=size.small, bgcolor=posC)

// ════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════
alertcondition(showPerfectBuy,    title="★ PERFECT BUY",    message="PERFECT BUY — Full size. Entry confirmed.")
alertcondition(showStrongBuy,     title="STRONG BUY",       message="STRONG BUY — Normal size entry.")
alertcondition(showConfirmedBuy,  title="CONFIRMED BUY",    message="CONFIRMED BUY — Reduced size entry.")
alertcondition(showBullCont,      title="TREND BUY",        message="TREND BUY — Bull continuation. Normal size.")
alertcondition(showPerfectSell,   title="★ PERFECT SELL",   message="PERFECT SELL — Full size. Entry confirmed.")
alertcondition(showStrongSell,    title="STRONG SELL",      message="STRONG SELL — Normal size entry.")
alertcondition(showConfirmedSell, title="CONFIRMED SELL",   message="CONFIRMED SELL — Reduced size entry.")
alertcondition(showBearCont,      title="TREND SELL",       message="TREND SELL — Bear continuation. Normal size.")
alertcondition(exitLong,          title="EXIT LONG",        message="EXIT LONG — Chandelier or WVF Top. Close position.")
alertcondition(exitShort,         title="EXIT SHORT",       message="EXIT SHORT — Chandelier or WVF Bottom. Close position.")
alertcondition(bearDiv,           title="⚠ BEAR DIV",      message="Bear RSI divergence — tighten long stop.")
alertcondition(bullDiv,           title="⚠ BULL DIV",      message="Bull RSI divergence — tighten short stop.")
alertcondition(squeezeFired,      title="SQUEEZE FIRED",    message="TTM Squeeze released — big move incoming.")
alertcondition(vwapReclaim,       title="VWAP RECLAIM",     message="VWAP reclaimed — long setup forming.")
alertcondition(isSessionOpen,     title="RTH OPEN",         message="9:30am — Market open. Watch for opening range setup.")
