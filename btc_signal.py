"""BTC 진입 타이밍 점검: 추적 손절 계획 (4시간 봉 마감마다 실행).
사용법:  python3 -I btc_signal.py collect <작업폴더>                 → 데이터 수집·판정, state.json / draft.txt / draft.html 생성
         python3 -I btc_signal.py send <작업폴더> [해석.txt] [제목머리말] → HTML 메일 발송 (Resend, 한 번만)
<작업폴더>/config.json 에서 개인 설정을 읽습니다 (이 파일에는 개인 값이 없습니다):
  {"mail_to": "받는 주소", "start_capital": 시작 자금, "balance": 현재 잔고, "target_balance": 목표 잔고, "target_note": "선택"}
진입 기준(일봉 09시 KST 판정):
  ① 하락 국면: 종가가 90일 고점 대비 -15% 이하
  ② 종가가 최근 20일 투매 저점 대비 +6% 이내
  ③ 신저가를 낸 당일이 아님(저점 후 1일 이상)
계획:
  - 시도당 최대 손실 = 시작 자금의 1/3, 포지션은 잔고의 12배 이하
  - 처음 손절가 = 투매 저점의 1% 아래
  - 추적 손절 = 매일 09시, 최근 7일 최저가의 1% 아래가 더 높으면 그쪽으로 올림
  - 손절되면 다음 신호에 재진입
악재·호재: brief_hours(기본 09시) 실행에서 <작업폴더>/brief.txt([악재]/[호재]/[일정]/[요약], "- 제목 | 설명 | URL")를 붙입니다.
급변동: 최근 24시간 1시간 봉 급등락을 참고로 표시합니다. <작업폴더>/news.txt가 있으면 원인 뉴스로 붙입니다("- 요약 | URL").
예정 이벤트: 저장소의 events.json(공식 발표 일정)과 계산한 옵션 만기를 참고로 표시합니다.
별첨: 저장소의 views.json에 있는 외부 의견을 메일 끝에 붙입니다(만료일이 지나면 자동으로 빠짐, 판정에는 쓰지 않음).
차트: matplotlib이 있으면 추세·박스 차트 PNG를 만들어 메일에 인라인 첨부합니다. 없으면 글로만 보냅니다.
"""
import json, re, html, time, subprocess, sys, os, datetime as dt

KST = dt.timezone(dt.timedelta(hours=9)); UTC = dt.timezone.utc
START_CAPITAL = BALANCE = TARGET_BAL = 0.0; TARGET_NOTE = ""; MAIL_TO = ""   # config.json에서 읽음
RISK_FRAC = 1/3          # 시도당 최대 손실 = 시작 자금의 1/3
LEV_CAP = 12             # 포지션은 잔고의 12배 이하
TRAIL_DAYS = 7           # 추적 손절: 최근 7일 최저가
MAX_DIST = 0.06          # 저점 대비 진입 허용 거리
DD_REGIME = -0.15        # 하락 국면 기준
LIQ_TIERS = [(5, .15), (10, .30), (25, .30), (50, .15), (100, .10)]   # 추정 청산 구간: 레버리지 가정과 비중
BOX_DAYS, BOX_AGE, BOX_WMIN, BOX_WMAX, BOX_ZONE, BOX_STOP = 20, 3, 0.06, 0.30, 0.02, 0.03   # 박스권 규칙 (백테스트 설정)
BOX_RISK_FRAC = 0.03     # 박스 하단 롱의 손실 한도 = 잔고의 3% (config.json의 box_risk_frac로 덮어씀)
BOX_LEV_CAP = 3
MAIL_FROM = "BTC 점검 <onboarding@resend.dev>"
BRIEF_HOURS = [9]        # 악재·호재 브리핑을 붙이는 실행 시각(KST 시). config.json의 brief_hours로 덮어씀
SHOCK_RET, SHOCK_RNG, SHOCK_MULT = 0.025, 0.035, 6   # 급변동: 1시간 봉 등락 2.5% 또는 봉 길이 3.5% 이상, 둘 다 평소(7일 중앙값)의 6배 이상

def load_config(wd):
    global START_CAPITAL, BALANCE, TARGET_BAL, TARGET_NOTE, MAIL_TO
    c = json.load(open(os.path.join(wd, "config.json")))
    START_CAPITAL = float(c["start_capital"]); BALANCE = float(c.get("balance", START_CAPITAL))
    TARGET_BAL = float(c["target_balance"]); TARGET_NOTE = c.get("target_note", ""); MAIL_TO = c["mail_to"]
    global BOX_RISK_FRAC; BOX_RISK_FRAC = float(c.get("box_risk_frac", BOX_RISK_FRAC))
    global BRIEF_HOURS; BRIEF_HOURS = [int(h) for h in c.get("brief_hours", [9])]

def get(url, tries=3):
    for i in range(tries):
        r = subprocess.run(["curl", "-sS", "--fail", "-m", "45", url], capture_output=True, text=True)
        if r.returncode == 0: return r.stdout
        if i == tries - 1: raise RuntimeError(r.stderr.strip()[:200])
        time.sleep(3)

def rule_state(O, H, L, C, i):
    """i번째 일봉 마감 시점의 진입 기준 상태."""
    dd = C[i] / max(H[max(0, i-89):i+1]) - 1
    lo = min(range(max(0, i-19), i+1), key=lambda j: L[j])
    k = i - lo; dist = C[i] / L[lo] - 1
    c1, c2, c3 = dd <= DD_REGIME, dist <= MAX_DIST, k >= 1
    return dict(dd=dd, lo=lo, low=L[lo], k=k, dist=dist, stop=L[lo]*0.99,
                c_regime=c1, c_dist=c2, c_notlowday=c3, signal=c1 and c2 and c3)

def liq_map(pages=8):
    """추정 청산 구간 (OKX BTC-USDT 무기한, 1시간 봉 약 33일).
    미결제약정이 늘어난 봉의 가격에 새 롱·숏이 생겼다고 보고 레버리지 가정으로 청산가를 계산합니다.
    미결제약정이 줄면 같은 비율로 줄이고, 가격이 지나간 구간은 이미 청산된 것으로 지웁니다."""
    def paged(base, key):
        rows = []; cur = None
        for _ in range(pages):
            d = json.loads(get(base + (f"&{key}={cur}" if cur else ""))).get("data", [])
            new = [x for x in d if not rows or int(x[0]) < int(rows[-1][0])]
            if not new: break
            rows += new; cur = new[-1][0]; time.sleep(0.45)
        return rows
    oi = {int(x[0]): float(x[2]) for x in paged("https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=100", "end")}
    cd = {int(x[0]): (float(x[2]), float(x[3]), float(x[4])) for x in paged("https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1H&limit=100", "after")}
    ts = sorted(set(oi) & set(cd)); longs = []; shorts = []
    for a, b in zip(ts, ts[1:]):
        h, l, c = cd[b]; dq = oi[b] - oi[a]
        if dq < 0 and oi[a] > 0:
            f = oi[b] / oi[a]
            for q in longs: q[1] *= f
            for q in shorts: q[1] *= f
        longs = [q for q in longs if q[0] < l]; shorts = [q for q in shorts if q[0] > h]
        if dq > 0:
            px = (h + l + c) / 3
            for lev, w in LIQ_TIERS:
                longs.append([px*(1 - 1/lev + 0.005), dq*w]); shorts.append([px*(1 + 1/lev - 0.005), dq*w])
    price = cd[ts[-1]][2]
    def tot(pos, lo, hi): return sum(q*lp for lp, q in pos if lo <= lp/price - 1 <= hi)
    def bands(pos, sign):
        agg = {}
        for lp, q in pos:
            k = int(abs(lp/price - 1) * 100)
            if k < 15: agg[k] = agg.get(k, 0) + q*lp
        top = sorted(agg.items(), key=lambda kv: -kv[1])[:3]
        return [dict(lo=price*(1 + sign*k/100) if sign > 0 else price*(1 - (k+1)/100),
                     hi=price*(1 + (k+1)/100) if sign > 0 else price*(1 - k/100), usd=v, mid=sign*(k + 0.5)/100)
                for k, v in sorted(top, key=lambda kv: kv[0])]
    return dict(price=price, hours=round((ts[-1] - ts[0])/3.6e6), above=bands(shorts, 1), below=bands(longs, -1),
                above5=tot(shorts, 0, .05), below5=tot(longs, -.05, 0), above10=tot(shorts, 0, .10), below10=tot(longs, -.10, 0))

def make_charts(wd, o):
    """추세·박스 차트 PNG 2장. matplotlib이 없으면 건너뜀 (메일은 글로만 나감)."""
    # 작업폴더 옆 pylib(pip --target 설치)이 있으면 시스템 경로보다 먼저 쓴다. 일부 컨테이너의 시스템 PIL이 깨져 있기 때문.
    alt = os.path.join(os.path.dirname(os.path.abspath(wd)), "pylib")
    if os.path.isdir(alt) and alt not in sys.path: sys.path.insert(0, alt)
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt; import matplotlib.dates as mdates
    except Exception as e:
        return [f"차트: matplotlib 없음 ({e}). 설치 상태를 확인하세요"]
    errs = []; sd, sh, bx = o.get("series_d"), o.get("series_h"), o.get("box")
    G, R, B, GR, Y = "#0f7b3f", "#b3261e", "#3b4bc4", "#8b949e", "#e0a100"
    def style(ax, title):
        ax.set_title(title, loc="left", fontsize=10, color="#24292f", pad=6)
        ax.grid(True, color="#eceff3", lw=0.8); ax.set_axisbelow(True)
        for sp in ("top", "right"): ax.spines[sp].set_visible(False)
        for sp in ("left", "bottom"): ax.spines[sp].set_color("#d8dee4")
        ax.tick_params(colors="#57606a", labelsize=8, length=0)
        ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
    # ── 차트 1: 추세 (위 일봉 120일, 아래 4시간 25일) ──
    try:
        if sd and sh:
            fig, (a1, a2) = plt.subplots(2, 1, figsize=(7.6, 5.6), dpi=150, gridspec_kw=dict(hspace=0.45))
            td = [dt.datetime.strptime(x, "%Y-%m-%d") for x in sd["t"]]
            a1.plot(td, sd["c"], color="#24292f", lw=1.3, label="Close"); a1.plot(td, sd["s20"], color=B, lw=1.1, label="SMA20"); a1.plot(td, sd["s50"], color=Y, lw=1.1, label="SMA50")
            a1.scatter([td[-1]], [sd["c"][-1]], color="#24292f", s=14, zorder=5)
            a1.annotate(f"{sd['c'][-1]:,.0f}", (td[-1], sd["c"][-1]), xytext=(4, 0), textcoords="offset points", fontsize=8, va="center")
            tm = o.get("trend_mid", {}).get("dir", ""); style(a1, f"Mid-term (daily, 120d)  {('UP' if tm=='상승' else 'DOWN' if tm=='하락' else 'NEUTRAL')}")
            a1.legend(loc="upper left", fontsize=7, frameon=False, ncol=3); a1.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d"))
            th = [dt.datetime.strptime(x, "%Y-%m-%d %H:%M") for x in sh["t"]]
            a2.plot(th, sh["c"], color="#24292f", lw=1.2, label="4H close"); a2.plot(th, sh["e12"], color=G, lw=1.1, label="EMA12"); a2.plot(th, sh["e48"], color=R, lw=1.1, label="EMA48")
            a2.scatter([th[-1]], [sh["c"][-1]], color="#24292f", s=14, zorder=5)
            a2.annotate(f"{sh['c'][-1]:,.0f}", (th[-1], sh["c"][-1]), xytext=(4, 0), textcoords="offset points", fontsize=8, va="center")
            tsd = o.get("trend_short", {}).get("dir", ""); style(a2, f"Short-term (4H, 25d)  {('UP' if tsd=='상승' else 'DOWN' if tsd=='하락' else 'NEUTRAL')}")
            a2.legend(loc="lower left", fontsize=7, frameon=False, ncol=3); a2.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d"))
            fig.savefig(os.path.join(wd, "chart_trend.png"), bbox_inches="tight", facecolor="white"); plt.close(fig)
    except Exception as e: errs.append(f"추세 차트: {e}")
    # ── 차트 2: 박스 (4시간 25일 + 20일 고점·저점·중간, 하단 2% 구간, 손절선) ──
    try:
        if sh and bx:
            fig, ax = plt.subplots(figsize=(7.6, 3.6), dpi=150)
            th = [dt.datetime.strptime(x, "%Y-%m-%d %H:%M") for x in sh["t"]]
            ax.fill_between(th, sh["l"], sh["h"], color="#d8dee4", alpha=0.6, lw=0, label="4H range")
            ax.plot(th, sh["c"], color="#24292f", lw=1.2, label="4H close")
            x0, x1 = th[0], th[-1]
            ax.hlines([bx["hi"], bx["lo"]], x0, x1, colors=[R, G], linestyles="--", lw=1.1)
            ax.hlines([bx["mid"]], x0, x1, colors=[GR], linestyles=":", lw=1.0)
            ax.axhspan(bx["lo"], bx["lo"]*(1+BOX_ZONE), color=G, alpha=0.12, lw=0, label="Long zone (low +2%)")
            ax.hlines([bx["lo"]*(1-BOX_STOP)], x0, x1, colors=[R], linestyles="-", lw=0.9, alpha=0.7)
            for y, txt, c in [(bx["hi"], f"High {bx['hi']:,.0f}", R), (bx["mid"], f"Mid {bx['mid']:,.0f}", GR), (bx["lo"], f"Low {bx['lo']:,.0f}", G), (bx["lo"]*(1-BOX_STOP), f"Stop {bx['lo']*(1-BOX_STOP):,.0f}", R)]:
                ax.annotate(txt, (x1, y), xytext=(4, 0), textcoords="offset points", fontsize=7.5, color=c, va="center")
            ax.scatter([th[-1]], [sh["c"][-1]], color="#24292f", s=14, zorder=5)
            lab = (f"BOX  {bx['w']*100:.1f}% wide, price at {bx['pos']*100:.0f}%" if bx["valid"] else f"NOT A BOX  (20d range {bx['w']*100:.0f}% wide)")
            style(ax, f"Box (20-day high/low, 4H)  {lab}"); ax.legend(loc="center left", fontsize=7, frameon=False)
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d")); ax.set_xlim(x0, x1 + (x1-x0)*0.14)
            fig.savefig(os.path.join(wd, "chart_box.png"), bbox_inches="tight", facecolor="white"); plt.close(fig)
    except Exception as e: errs.append(f"박스 차트: {e}")
    return errs

def collect(wd):
    load_config(wd)
    now = dt.datetime.now(KST); out = {"run_at_kst": now.strftime("%Y-%m-%d %H:%M")}; err = []

    # 1) 일봉 (Coinbase BTC-USD, UTC 00:00 = KST 09:00 마감)
    try:
        c = sorted(json.loads(get("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400")), key=lambda x: x[0])
        t0 = int(dt.datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        done = [x for x in c if x[0] < t0]; live = [x for x in c if x[0] == t0]
        ts = [x[0] for x in done]; L = [x[1] for x in done]; H = [x[2] for x in done]; O = [x[3] for x in done]; C = [x[4] for x in done]
        i = len(done) - 1
        bar = lambda t: dt.datetime.fromtimestamp(t, KST).strftime("%m/%d")           # 봉 시작일(KST 09시)
        s = rule_state(O, H, L, C, i)
        streak = 0
        for j in range(i, max(i-30, 100), -1):
            if rule_state(O, H, L, C, j)["signal"]: streak += 1
            else: break
        trail_low = min(L[i-TRAIL_DAYS+1:i+1])
        sma50 = sum(C[i-49:i+1])/50; sma20 = sum(C[i-19:i+1])/20
        hh20, ll20 = max(H[i-19:i+1]), min(L[i-19:i+1]); hh20p, ll20p = max(H[i-39:i-19]), min(L[i-39:i-19])
        mt_dir = "상승" if C[i] > sma50 and sma20 > sma50 else "하락" if C[i] < sma50 and sma20 < sma50 else "중립"
        out["trend_mid"] = dict(dir=mt_dir, sma50=sma50, sma20=sma20, chg30=C[i]/C[i-30]-1, dd90=C[i]/max(H[i-89:i+1])-1,
                                hh=("높아짐" if hh20 > hh20p else "낮아짐"), ll=("높아짐" if ll20 > ll20p else "낮아짐"), hh20=hh20, ll20=ll20)
        out["series_d"] = dict(t=[dt.datetime.fromtimestamp(x+86400, KST).strftime("%Y-%m-%d") for x in ts[-120:]], c=C[-120:], h=H[-120:], l=L[-120:],
                               s20=[sum(C[j-19:j+1])/20 for j in range(i-119, i+1)], s50=[sum(C[j-49:j+1])/50 for j in range(i-119, i+1)])
        out["daily"] = dict(close_time=dt.datetime.fromtimestamp(ts[i]+86400, KST).strftime("%m/%d %H:%M"),
                            close=C[i], bar_low=L[i], bar_high=H[i], low_bar=bar(ts[s["lo"]]), streak=streak,
                            high90=max(H[i-89:i+1]), trail_low=trail_low, trail_stop=trail_low*0.99,
                            **{k: v for k, v in s.items() if k != "lo"})
        if live:
            lv = live[0]; price = lv[4]
            p = rule_state(O+[lv[3]], H+[lv[2]], L+[lv[1]], C+[price], i+1)   # 지금 가격으로 마감한다고 가정
            out["live"] = dict(price=price, low=lv[1], high=lv[2], open=lv[3],
                               broke_low=lv[1] < s["low"], hit_stop=lv[1] <= s["stop"],
                               hit_trail=lv[1] <= trail_low*0.99, dist_now=price/s["low"]-1,
                               proj={k: v for k, v in p.items() if k != "lo"}, proj_low_bar=bar((ts+[lv[0]])[p["lo"]]))
    except Exception as e: err.append(f"일봉: {e}")

    # 2) 4시간 봉 (OKX BTC-USDT 현물, 최근 300개 = 50일) → 최근 봉 표시, 박스권, 단기 추세
    try:
        rows = json.loads(get("https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=4H&limit=300"))["data"]
        closed = [r for r in rows if r[8] == "1"]                       # 최신이 먼저
        out["h4"] = [dict(close_time=dt.datetime.fromtimestamp(int(r[0])/1000 + 14400, KST).strftime("%m/%d %H:%M"),
                          open=float(r[1]), high=float(r[2]), low=float(r[3]), close=float(r[4])) for r in closed[:6]]
        b = closed[::-1]                                                 # 오래된 것부터
        hO = [float(r[1]) for r in b]; hH = [float(r[2]) for r in b]; hL = [float(r[3]) for r in b]; hC = [float(r[4]) for r in b]
        n = BOX_DAYS*6; i = len(b)-1
        if i >= n:
            lo_i = min(range(i-n+1, i+1), key=lambda j: hL[j]); hi_i = max(range(i-n+1, i+1), key=lambda j: hH[j])
            lo, hi = hL[lo_i], hH[hi_i]; w = hi/lo - 1; lo_age = (i-lo_i)/6; hi_age = (i-hi_i)/6
            valid = lo_age >= BOX_AGE and hi_age >= BOX_AGE and BOX_WMIN <= w <= BOX_WMAX
            why = []
            if lo_age < BOX_AGE: why.append(f"저점이 {lo_age:.1f}일 전 (3일 이상 필요)")
            if hi_age < BOX_AGE: why.append(f"고점이 {hi_age:.1f}일 전 (3일 이상 필요)")
            if w > BOX_WMAX: why.append(f"폭 {w*100:.0f}%로 30% 초과 (아직 추세 중)")
            if w < BOX_WMIN: why.append(f"폭 {w*100:.1f}%로 6% 미만")
            near_low = hC[i] <= lo*(1+BOX_ZONE); up_close = hC[i] > hC[i-1]; above_low = hC[i] > lo
            long_ok = valid and near_low and up_close and above_low
            # 11월 초 고점처럼 폭을 키우는 봉이 창에서 빠지는 시점
            drop_days = None
            if w > BOX_WMAX:
                for k in range(1, n):
                    if max(hH[i-n+1+k:i+1]) / min(hL[i-n+1+k:i+1]) - 1 <= BOX_WMAX: drop_days = k/6; break
            out["box"] = dict(lo=lo, hi=hi, mid=(lo+hi)/2, w=w, lo_age=lo_age, hi_age=hi_age, valid=valid, why=why,
                              lo_time=dt.datetime.fromtimestamp(int(b[lo_i][0])/1000 + 14400, KST).strftime("%m/%d %H:%M"),
                              hi_time=dt.datetime.fromtimestamp(int(b[hi_i][0])/1000 + 14400, KST).strftime("%m/%d %H:%M"),
                              pos=(hC[i]-lo)/(hi-lo) if hi > lo else 0, last_close=hC[i], near_low=near_low, up_close=up_close,
                              above_low=above_low, long_ok=long_ok, broke_low=hC[i] < lo, broke_high=hC[i] > hi, drop_days=drop_days,
                              last_close_time=out["h4"][0]["close_time"])
        # 단기 추세 (4시간 봉): EMA12/EMA48 + 5일 등락
        def ema(x, k):
            e = [x[0]]; a = 2/(k+1)
            for v in x[1:]: e.append(e[-1] + a*(v-e[-1]))
            return e
        e12, e48 = ema(hC, 12), ema(hC, 48)
        chg5 = hC[i]/hC[i-30] - 1 if i >= 30 else 0
        st_dir = "상승" if e12[i] > e48[i] and hC[i] > e48[i] else "하락" if e12[i] < e48[i] and hC[i] < e48[i] else "중립"
        out["series_h"] = dict(t=[dt.datetime.fromtimestamp(int(r[0])/1000 + 14400, KST).strftime("%Y-%m-%d %H:%M") for r in b[-150:]],
                               c=hC[-150:], h=hH[-150:], l=hL[-150:], e12=e12[-150:], e48=e48[-150:])
        out["trend_short"] = dict(dir=st_dir, e12=e12[i], e48=e48[i], chg5=chg5,
                                  cross_days=next((k/6 for k in range(1, min(i, 200)) if (e12[i-k] > e48[i-k]) != (e12[i] > e48[i])), None))
    except Exception as e: err.append(f"4시간봉: {e}")

    # 3) 보조: 펀딩비 (OKX)
    try:
        f = json.loads(get("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP"))["data"][0]
        h = json.loads(get("https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=3"))["data"]
        out["funding"] = dict(current_pct=float(f["fundingRate"])*100, recent_pct=[round(float(x["realizedRate"])*100, 4) for x in h])
    except Exception as e: err.append(f"펀딩비: {e}")

    # 4) 보조: 24시간 청산 롱 비중 (OKX BTC-USDT 무기한, 1계약 = 0.01 BTC)
    try:
        cutoff = (time.time() - 86400) * 1000; lg = sh = 0.0; after = None; oldest = None
        for _ in range(250):
            u = "https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=100" + (f"&after={after}" if after else "")
            det = json.loads(get(u))["data"]; det = det[0]["details"] if det else []
            if not det: break
            stop = False
            for x in det:
                t = int(x["ts"])
                if t < cutoff: stop = True; break
                usd = float(x["sz"]) * 0.01 * float(x["bkPx"])
                if x["posSide"] == "long": lg += usd
                else: sh += usd
                oldest = t
            if stop: break
            after = det[-1]["ts"]; time.sleep(0.12)
        tot = lg + sh
        out["liq"] = dict(long_usd=round(lg), short_usd=round(sh), long_pct=round(lg/tot*100, 1) if tot else None,
                          hours=round((time.time()*1000 - oldest)/3.6e6, 1) if oldest else 0)
    except Exception as e: err.append(f"청산: {e}")

    # 5) 보조: 현물 ETF 순유출입 (TFTC, $M)
    try:
        rows = []; m = now.date().replace(day=1)
        for mm in [m, (m - dt.timedelta(days=1)).replace(day=1)]:
            t = get(f"https://www.tftc.io/bitcoin-etf-flows/{mm.strftime('%B').lower()}-{mm.year}")
            t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
            t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))
            num = r"\(?-?[\d,]+\.\d\)?"
            for g in re.finditer(r"([A-Z][a-z]{2} \d{1,2}, \d{4})((?: " + num + r"){5,})", t[t.find("daily flow table"):]):
                v = g.group(2).split()[-1]
                rows.append((dt.datetime.strptime(g.group(1), "%b %d, %Y").date(), (-1 if v.startswith("(") else 1) * float(v.strip("()").replace(",", ""))))
        out["etf"] = [(r[0].strftime("%m/%d"), r[1]) for r in sorted(set(rows))[-5:]]
    except Exception as e: err.append(f"ETF: {e}")

    # 6) 보조: 나스닥 종합 (FRED)
    try:
        s0 = (now - dt.timedelta(days=12)).strftime("%Y-%m-%d")
        ls = [l.split(",") for l in get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQCOM&cosd={s0}").splitlines()[1:]]
        ls = [(a, float(b)) for a, b in ls if b not in ("", ".")]
        out["nasdaq"] = dict(date=ls[-1][0][5:].replace("-", "/"), close=ls[-1][1], chg_pct=round((ls[-1][1]/ls[-2][1]-1)*100, 2))
    except Exception as e: err.append(f"나스닥: {e}")

    # 7) 참고: 추정 청산 구간 (OKX 미결제약정 기반)
    try: out["liqmap"] = liq_map()
    except Exception as e: err.append(f"청산 구간: {e}")

    out["brief_due"] = now.hour in BRIEF_HOURS                 # 이 실행에서 악재·호재 브리핑(brief.txt)을 붙이는지

    # 8) 참고: 최근 24시간 급변동 (1시간 봉)
    try: out["shock"] = shocks(now)
    except Exception as e: err.append(f"급변동 감지: {e}")

    # 9) 참고: 예정 이벤트 일정 (저장소의 events.json + 옵션 만기 계산)
    try:
        out["events"] = load_events(now)
        if out["events"]["stale"]: err.append(f"이벤트 일정 파일이 {out['events']['stale']}까지만 있습니다. 갱신이 필요합니다")
    except Exception as e: err.append(f"이벤트 일정: {e}")

    # 10) 별첨: 외부 전문가 의견 (저장소의 views.json, 판정에는 쓰지 않음)
    try: out["views"] = load_views(now)
    except Exception as e: err.append(f"외부 의견 파일: {e}")

    os.makedirs(wd, exist_ok=True)
    err += make_charts(wd, out)
    out["charts"] = {k: os.path.exists(os.path.join(wd, f"chart_{k}.png")) for k in ("trend", "box")}
    out["errors"] = err
    subject, body, doc = compose(out)
    out["subject"] = subject
    json.dump(out, open(os.path.join(wd, "state.json"), "w"), ensure_ascii=False, indent=1)
    open(os.path.join(wd, "draft.txt"), "w").write(body)
    open(os.path.join(wd, "draft.html"), "w").write(doc)
    print("SUBJECT:", subject); print(body); print("\n--- state.json ---"); print(json.dumps(out, ensure_ascii=False))

def shocks(now):
    """최근 24시간 1시간 봉에서 급등락을 찾는다 (OKX BTC-USDT 현물, 확정봉만). 참고용, 판정에는 쓰지 않는다."""
    d = json.loads(get("https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=220"))["data"][::-1]
    last_px = float(d[-1][4])                                   # 진행 중인 봉 포함 가장 최근 가격
    d = [r for r in d if r[8] == "1"]
    T = [int(r[0]) for r in d]; O, H, L, C = ([float(r[k]) for r in d] for k in (1, 2, 3, 4)); N = len(d)
    ret = [abs(C[i]/O[i]-1) for i in range(N)]; rng = [(H[i]-L[i])/O[i] for i in range(N)]
    med = lambda x: sorted(x)[len(x)//2]
    since = (now - dt.timedelta(hours=24)).timestamp() * 1000
    flag = []
    for i in range(168, N):
        if T[i] < since: continue
        mr, mg = med(ret[i-168:i]), med(rng[i-168:i])
        if (ret[i] >= SHOCK_RET and ret[i] >= SHOCK_MULT*mr) or (rng[i] >= SHOCK_RNG and rng[i] >= SHOCK_MULT*mg): flag.append(i)
    ev = []
    for i in flag:                                              # 3시간 안에 이어진 봉은 한 사건으로 묶음
        if ev and i - ev[-1]["last"] <= 3: ev[-1]["last"] = i; continue
        ev.append(dict(first=i, last=i))
    out = []
    for e in ev:
        a, b = e["first"], min(e["last"] + 3, N - 1)
        pre = O[a]; up = C[e["first"]] >= O[a] if e["first"] == e["last"] else max(H[a:b+1])/pre - 1 >= 1 - min(L[a:b+1])/pre
        ext = max(H[a:b+1]) if up else min(L[a:b+1])
        retr = (ext - last_px) / (ext - pre) if ext != pre else 0
        t0 = dt.datetime.fromtimestamp(T[a]/1000, KST)
        out.append(dict(start_kst=t0.strftime("%m/%d %H시"), start_utc=dt.datetime.fromtimestamp(T[a]/1000, UTC).strftime("%Y-%m-%d %H:%M UTC"),
                        up=up, pre=pre, ext=ext, ext_pct=ext/pre-1, bar_pct=C[a]/O[a]-1, bars=e["last"]-a+1, now=last_px, now_pct=last_px/pre-1, retrace=retr,
                        typical=med(ret[a-168:a])))
    return out

def load_events(now):
    """저장소 events.json의 예정 이벤트 + 계산되는 옵션 만기. 지난 12시간 ~ 앞으로 21일."""
    fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")
    ev = []; stale = None
    if os.path.exists(fp):
        j = json.load(open(fp))
        for e in j.get("events", []):
            ev.append(dict(t=dt.datetime.strptime(e["utc"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC), name=e["name"], level=e.get("level", 2)))
        vu = dt.datetime.strptime(j.get("valid_until", "2000-01-01"), "%Y-%m-%d").replace(tzinfo=UTC)
        if now > vu - dt.timedelta(days=14): stale = j.get("valid_until")
    y, m = now.year, now.month
    for k in range(3):                                          # Deribit 월말 옵션 만기: 마지막 금요일 08:00 UTC
        yy, mm = y + (m - 1 + k) // 12, (m - 1 + k) % 12 + 1
        d = dt.datetime(yy + (mm == 12), mm % 12 + 1, 1, 8, tzinfo=UTC) - dt.timedelta(days=1)
        while d.weekday() != 4: d -= dt.timedelta(days=1)
        q = mm in (3, 6, 9, 12)
        ev.append(dict(t=d, name="비트코인 옵션 " + ("분기 만기 (규모 큼)" if q else "월말 만기") + " · Deribit", level=2 if q else 1))
    out = []
    for e in sorted(ev, key=lambda e: e["t"]):
        h = (e["t"] - now).total_seconds() / 3600
        if -12 <= h <= 21*24:
            out.append(dict(kst=e["t"].astimezone(KST).strftime("%m/%d(%a) %H:%M").replace("Mon", "월").replace("Tue", "화").replace("Wed", "수").replace("Thu", "목").replace("Fri", "금").replace("Sat", "토").replace("Sun", "일"),
                            name=e["name"], level=e["level"], hours=h))
    return dict(items=out, stale=stale)

def load_views(now):
    """저장소의 views.json에서 아직 유효한 외부 의견만 고른다."""
    fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "views.json")
    if not os.path.exists(fp): return []
    keep = []
    for v in json.load(open(fp)).get("views", []):
        t = dt.datetime.strptime(v["posted_kst"], "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        age = (now - t).total_seconds() / 86400
        if age <= v.get("expires_days", 21): keep.append(dict(v, age_days=age))
    return keep

def view_levels(v, px):
    """의견 속 가격대마다 기준 가격(마지막 4시간 종가)이 위·안·아래 중 어디인지."""
    rows = []
    for lv in v.get("levels", []):
        pos = "above" if px > lv["hi"] else "below" if px < lv["lo"] else "inside"
        ref = lv["hi"] if pos == "above" else lv["lo"]
        rows.append(dict(lv, pos=pos, msg=lv[pos], gap=px/ref-1))
    return rows

def ago(d): return f"{d*24:.0f}시간 전" if d < 1 else f"{d:.0f}일 전"

def mark(b): return "✓" if b else "✗"
def usd(x): return f"${x:,.0f}"
def pc(x): return f"{x*100:+.1f}%"
esc = html.escape

def sizing(entry, stop):
    """계획의 포지션 크기와 거래소에 넣을 값(권고 레버리지, 주문 금액, 증거금).
    손절 시 손실 = (시작 자금의 1/3)과 현재 잔고 중 작은 쪽, 포지션은 잔고의 12배 이하.
    권고 레버리지 = 증거금이 잔고 안에 들어가고, 청산가가 손절가보다 충분히 아래에 오도록 고른 격리 마진 설정값."""
    dist = (entry - stop) / entry
    if dist <= 0: return None
    risk = min(START_CAPITAL * RISK_FRAC, BALANCE)
    want = risk / dist; cap = LEV_CAP * BALANCE; notional = min(want, cap); capped = want > cap
    lev_safe = max(1, int(1 / (dist + 0.02)))                # 청산가가 손절가보다 약 1.5% 이상 아래
    lev_set = max(1, min(int(-(-notional // BALANCE)) + 1, lev_safe))
    shrunk = notional > BALANCE * lev_set * 0.97             # 증거금·수수료가 잔고를 넘으면 포지션을 줄임
    if shrunk: notional = BALANCE * lev_set * 0.97
    qty = int(notional / entry * 1000) / 1000                # Bybit BTCUSDT 최소 단위 0.001 BTC
    notional = qty * entry
    return dict(entry=entry, stop=stop, dist=dist, notional=notional, qty=qty, lev=notional/BALANCE,
                capped=capped, shrunk=shrunk, loss=notional*dist, need=(TARGET_BAL - BALANCE)/notional if notional else 0,
                lev_set=lev_set, margin=notional/lev_set, liq=entry*(1 - 1/lev_set + 0.005))

def size_lines(z):
    if not z or z["qty"] <= 0: return ["- 현재가가 손절가 아래이거나 잔고가 부족해 계산하지 않습니다."]
    return [f"- 진입가 {usd(z['entry'])}, 손절가 {usd(z['stop'])} (진입가 대비 -{z['dist']*100:.1f}%)",
            f"- 권고 레버리지 {z['lev_set']}배 (격리 마진), 주문 금액 {z['notional']:,.0f} USDT = {z['qty']:.3f} BTC",
            f"- 증거금 약 {z['margin']:,.0f} USDT (잔고 {BALANCE:,.0f}의 {z['margin']/BALANCE*100:.0f}%), 예상 청산가 약 {usd(z['liq'])} (손절가보다 아래)",
            f"- 손절 시 손실 약 {z['loss']:,.0f} USDT (잔고의 {z['loss']/BALANCE*100:.0f}%), 포지션은 잔고의 {z['lev']:.1f}배"
            + (" (12배 상한 적용)" if z["capped"] else "") + (" (청산가 여유를 위해 축소)" if z["shrunk"] else ""),
            f"- 참고: 한 번의 진입만으로 목표 잔고 {TARGET_BAL:,.0f}까지 가려면 가격 {pc(z['need'])} (약 {usd(z['entry']*(1+z['need']))})"]

# ── HTML 조각 ──
KIND = {"go": ("#0f7b3f", "#e6f4ea", "#34a853"), "wait": ("#4b5563", "#f1f3f5", "#9aa4b2"),
        "void": ("#b3261e", "#fdecea", "#e5534b"), "far": ("#8a5a00", "#fff4d6", "#e0a100"), "error": ("#b3261e", "#fdecea", "#e5534b")}
FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif"
def card(title, inner, border="#d8dee4", bg="#ffffff", tcolor="#57606a", thick=False):
    t = f'<div style="font-size:12px;font-weight:700;color:{tcolor};margin:0 0 10px">{title}</div>' if title else ""
    bw = "2px" if thick else "1px"
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:{bw} solid {border};border-radius:12px;background:{bg}">'
            f'<tr><td style="padding:14px 16px;{FONT}">{t}{inner}</td></tr></table>')
def tiles(items):
    cells = "".join(f'<td width="50%" valign="top" style="padding:6px 8px 6px 0;{FONT}"><div style="font-size:12px;color:#57606a">{esc(l)}</div>'
                    f'<div style="font-size:20px;font-weight:700;color:{c};line-height:1.3">{esc(v)}</div><div style="font-size:12px;color:#57606a">{esc(sub)}</div></td>'
                    + ("</tr><tr>" if n % 2 else "") for n, (l, v, sub, c) in enumerate(items))
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>{cells}</tr></table>'
def ul(lines, size=14, color="#24292f"):
    return "".join(f'<div style="font-size:{size}px;color:{color};line-height:1.55;margin:0 0 4px">{esc(x.lstrip("- ").strip())}</div>' for x in lines)
def checks(rows):
    return "".join(f'<div style="font-size:14px;line-height:1.55;margin:0 0 4px;color:#24292f"><span style="font-weight:700;color:{"#0f7b3f" if ok else "#b3261e"}">{mark(ok)}</span> {esc(t)}</div>' for ok, t in rows)

def compose(o):
    d = o.get("daily"); lv = o.get("live"); now = dt.datetime.strptime(o["run_at_kst"], "%Y-%m-%d %H:%M")
    tag = now.strftime("%m/%d %H시")
    if not d:
        subj = f"[BTC 4H {tag}] 판정 불가 (가격 데이터 오류)"; msg = "가격 데이터를 받지 못해 판정하지 못했습니다.\n오류: " + "; ".join(o["errors"])
        return subj, msg, f'<div style="{FONT};font-size:15px;color:#b3261e">{esc(msg)}</div>'
    price = lv["price"] if lv else d["close"]
    # ── 상태 결정 ──
    if d["signal"] and lv and lv["hit_stop"]:
        kind, status, head = "void", "신호 무효 (손절가 도달)", f"09시 진입 조건은 충족했지만 이후 손절가 {usd(d['stop'])}에 닿았습니다. 새 저점 기준으로 다시 봅니다."
    elif d["signal"] and lv and lv["dist_now"] > MAX_DIST:
        kind, status, head = "far", "조건 충족, 현재가는 거리 초과", f"09시 진입 조건은 충족했지만 현재가가 저점 대비 {pc(lv['dist_now'])}로 6%를 넘었습니다. 지금 진입하면 손절 폭이 넓어집니다."
    elif d["signal"]:
        kind, status = "go", "진입 조건 충족" + (f" ({d['streak']}일째)" if d["streak"] > 1 else " (신규)")
        head = f"일봉 진입 기준 3가지를 모두 충족했습니다. 보유 중이 아니면 진입 자리입니다. 처음 손절가는 {usd(d['stop'])}입니다."
    else:
        why = []
        if not d["c_regime"]: why.append("하락 국면 아님")
        if not d["c_notlowday"]: why.append("신저가를 낸 당일")
        if not d["c_dist"]: why.append(f"저점 대비 {pc(d['dist'])}로 6% 초과")
        kind, status, head = "wait", "대기", "진입 조건 미충족: " + ", ".join(why) + "."
    subject = f"[BTC 4H {tag}] {status} · {usd(price)}"
    # ── 내용 조립 (텍스트와 HTML이 같은 값을 씀) ──
    crit_title = f"진입 기준 판정 ({d['close_time']} 마감 일봉, 종가 {usd(d['close'])})"
    crit = [(d["c_regime"], f"하락 국면: 90일 고점 {usd(d['high90'])} 대비 {pc(d['dd'])} (기준 -15% 이하)"),
            (d["c_dist"], f"저점 거리: 투매 저점 {usd(d['low'])}({d['low_bar']} 봉) 대비 {pc(d['dist'])} (기준 +6% 이내)"),
            (d["c_notlowday"], f"신저가 당일 아님: 저점 후 {d['k']}일 경과 (기준 1일 이상)")]
    real = d["signal"] and not (lv and lv["hit_stop"])
    if real: size_title, z = f"진입 시 수량 (현재가 기준, 잔고 {BALANCE:,.0f} USDT)", sizing(price, d["stop"])
    elif lv:
        plow = lv["proj"]["low"]; cap_px = plow * (1 + MAX_DIST)
        if price <= cap_px: size_title, z = f"조건이 채워지면 (예상: 저점 {usd(plow)} 유지, 지금 가격에 진입한다고 가정)", sizing(price, plow*0.99)
        else: size_title, z = f"조건이 채워지면 (예상: 저점 {usd(plow)} 유지, 규칙상 최고 진입가 {usd(cap_px)} 기준. 현재가 {usd(price)}는 저점 대비 6%를 넘어 진입 불가)", sizing(cap_px, plow*0.99)
    else: size_title, z = None, None
    trail = [f"- 오늘의 추적 손절가 {usd(d['trail_stop'])} (최근 {TRAIL_DAYS}일 최저가 {usd(d['trail_low'])}의 1% 아래)",
             "- 지금 걸어 둔 손절가보다 높으면 이 값으로 올리고, 낮으면 그대로 둡니다. 오늘 새로 진입했다면 내일 09시부터 적용합니다."]
    trail_hit = None
    if lv:
        trail_hit = lv["hit_trail"]
        trail_msg = (f"오늘 저가 {usd(lv['low'])}가 이 값에 닿았습니다. 이 값을 손절가로 두고 보유 중이었다면 오늘 청산된 자리입니다. 다음 진입 신호를 기다립니다." if trail_hit
                     else f"오늘 저가 {usd(lv['low'])}는 이 값에 닿지 않았습니다 (현재가는 손절가보다 {pc(lv['price']/d['trail_stop']-1)} 위).")
        trail.append("- " + trail_msg)
    livel = []
    if lv:
        p = lv["proj"]
        livel += [f"- 현재가 {usd(lv['price'])}, 오늘 고가 {usd(lv['high'])} / 저가 {usd(lv['low'])}",
                  f"- 투매 저점 {usd(d['low'])} " + ("이탈: 오늘 새 저점을 냈습니다." if lv["broke_low"] else f"유지 중 (현재가는 저점 대비 {pc(lv['dist_now'])})")]
        if p["signal"]:
            livel.append(f"- 지금 가격으로 마감하면 다음 09시 판정: 충족 (저점 {usd(p['low'])} 대비 {pc(p['dist'])}, 손절가 {usd(p['stop'])})")
        else:
            w = []
            if not p["c_regime"]: w.append("하락 국면 아님")
            if not p["c_notlowday"]: w.append("오늘이 신저가 당일")
            if not p["c_dist"]: w.append(f"저점 대비 {pc(p['dist'])}로 6% 초과")
            livel.append("- 지금 가격으로 마감하면 다음 09시 판정: 미충족 (" + ", ".join(w) + ")")
            if not p["c_notlowday"]:
                livel.append(f"  → 가장 빠른 충족은 그다음 날 09시입니다. 새 저점 {usd(p['low'])}이 유지되고 종가가 {usd(p['low']*(1+MAX_DIST))} 이하여야 합니다.")
    h4 = [f"- {b['close_time']} 마감: {usd(b['open'])} → {usd(b['close'])} ({pc(b['close']/b['open']-1)}), 저가 {usd(b['low'])}" for b in (o.get("h4") or [])[:4]]
    aux = []
    if o.get("etf"):
        e = o["etf"][-3:]; aux.append((all(v > 0 for _, v in e), "ETF 3일 연속 유입: " + " → ".join(f"{a} {v:+,.1f}" for a, v in e) + " ($M)"))
    if o.get("funding"): aux.append((o["funding"]["current_pct"] <= 0, f"펀딩비 0 이하: 현재 {o['funding']['current_pct']:+.4f}% (OKX)"))
    if o.get("liq") and o["liq"]["long_pct"] is not None:
        q = o["liq"]; aux.append((q["long_pct"] < 50, f"롱 청산 50% 미만: 롱 비중 {q['long_pct']}% (롱 ${q['long_usd']/1e6:.1f}M, 숏 ${q['short_usd']/1e6:.1f}M, OKX {q['hours']}시간)"))
    if o.get("nasdaq"): aux.append((o["nasdaq"]["chg_pct"] > 0, f"나스닥 상승: {o['nasdaq']['date']} {o['nasdaq']['chg_pct']:+.2f}%"))
    lm = o.get("liqmap"); lml = []
    if lm:
        m = lambda v: f"${v/1e6:,.0f}M"
        lml = [f"- 위 {usd(b['lo'])}~{usd(b['hi'])} ({pc(b['mid'])}): 숏 청산 약 {m(b['usd'])}" for b in reversed(lm["above"])]
        lml += [f"- 아래 {usd(b['lo'])}~{usd(b['hi'])} ({pc(b['mid'])}): 롱 청산 약 {m(b['usd'])}" for b in lm["below"]]
        lml += [f"- 현재가 5% 이내: 아래(롱) {m(lm['below5'])} / 위(숏) {m(lm['above5'])}. 10% 이내: 아래 {m(lm['below10'])} / 위 {m(lm['above10'])}",
                f"- OKX 무기한 최근 약 {lm['hours']//24}일의 미결제약정 변화에 레버리지 5~100배를 가정한 추정치입니다. 기준가 {usd(lm['price'])}"]
    lm_title = "추정 청산 구간 (OKX 기준 추정, 진입 판정에는 쓰지 않음)"
    # ── 박스권 ──
    bx = o.get("box"); bxl = []; bx_kind = "wait"; bx_head = ""
    if bx:
        if bx["valid"]:
            bxl = [f"- 박스 섰음: 하단 {usd(bx['lo'])} ({bx['lo_time']}) ~ 상단 {usd(bx['hi'])} ({bx['hi_time']}), 폭 {bx['w']*100:.1f}%, 중간 {usd(bx['mid'])}",
                   f"- 마지막 4시간 종가 {usd(bx['last_close'])}는 박스의 {bx['pos']*100:.0f}% 위치 (0%=하단, 100%=상단)"]
            if bx["broke_low"]: bx_kind, bx_head = "void", "4시간 종가가 하단 아래로 마감했습니다. 이탈 가능성이 있어 하단 롱은 하지 않습니다. 보유 중이면 정리 대상입니다."
            elif bx["long_ok"]: bx_kind, bx_head = "go", f"하단 롱 조건 충족: 종가가 하단 2% 이내이고 직전 봉보다 높게 마감했습니다."
            elif bx["near_low"]: bx_kind, bx_head = "far", f"하단 2% 이내이지만 아직 반등 봉(직전 봉보다 높은 마감)이 나오지 않았습니다. 다음 4시간 봉을 봅니다."
            elif bx["pos"] > 0.8: bx_kind, bx_head = "wait", "상단 근처입니다. 숏은 하지 않고, 보유 중인 하단 롱이 있으면 남은 물량을 정리하는 자리입니다."
            else: bx_kind, bx_head = "wait", "박스 중간입니다. 할 일이 없습니다."
            bxl.append("- " + bx_head)
            if bx["long_ok"] or bx["near_low"]:
                entry = bx["last_close"]; stop = bx["lo"]*(1-BOX_STOP); dist = (entry-stop)/entry
                risk = BALANCE*BOX_RISK_FRAC; notional = min(risk/dist, BOX_LEV_CAP*BALANCE) if dist > 0 else 0; qty = int(notional/entry*1000)/1000
                bx_size = dict(entry=entry, stop=stop, tgt=bx["mid"], dist=dist, risk=risk, notional=qty*entry, qty=qty, lev=qty*entry/BALANCE,
                               rr=(bx["mid"]-entry)/(entry-stop) if entry > stop else 0)
                bxl += [f"- 하단 롱 주문 예시 (손실 한도 잔고의 {BOX_RISK_FRAC*100:.0f}% = {risk:,.0f} USDT): 진입 {usd(entry)}, 손절 {usd(stop)} (-{dist*100:.1f}%), 1차 목표 {usd(bx['mid'])} (손익비 {bx_size['rr']:.1f})",
                        f"  수량 {qty:.3f} BTC = {qty*entry:,.0f} USDT (잔고의 {qty*entry/BALANCE:.1f}배, 레버리지 1~{BOX_LEV_CAP}배면 충분). 10일 안에 목표 미도달 시 정리"]
            else: bx_size = None
        else:
            bxl = [f"- 박스 아님: 최근 20일 저점 {usd(bx['lo'])} ({bx['lo_time']}), 고점 {usd(bx['hi'])} ({bx['hi_time']}), 폭 {bx['w']*100:.0f}%",
                   "- 이유: " + ", ".join(bx["why"])]
            if bx["drop_days"] is not None: bxl.append(f"- 새 저점·고점이 없으면 약 {bx['drop_days']:.0f}일 뒤 폭이 30% 아래로 내려와 박스 후보가 됩니다")
            bx_size = None
        bxl.append("- 규칙: 하단 2% 이내 + 반등 봉에서만 롱, 손절 하단 3% 아래, 1차 목표 박스 중간. 상단 숏은 하지 않음 (백테스트 평균 -0.29R)")
    bx_title = "5. 박스권 (20일 고점·저점 기준, 본 계획과 별도의 작은 거래)"
    # ── 추세 ──
    ts_, tm_ = o.get("trend_short"), o.get("trend_mid"); trl = []
    if ts_:
        cd = f", 교차 후 {ts_['cross_days']:.1f}일" if ts_["cross_days"] is not None else ""
        trl.append(f"- 단기 (며칠, 4시간 봉): {ts_['dir']} · EMA12 {usd(ts_['e12'])} {'>' if ts_['e12'] > ts_['e48'] else '<'} EMA48 {usd(ts_['e48'])}{cd} · 5일 등락 {pc(ts_['chg5'])}")
    if tm_:
        trl.append(f"- 중기 (몇 주, 일봉): {tm_['dir']} · 종가 {'>' if d['close'] > tm_['sma50'] else '<'} 50일 평균 {usd(tm_['sma50'])}, 20일 평균 {usd(tm_['sma20'])} · 30일 등락 {pc(tm_['chg30'])}")
        trl.append(f"- 고점·저점 흐름 (20일 단위): 고점 {tm_['hh']} ({usd(tm_['hh20'])}), 저점 {tm_['ll']} ({usd(tm_['ll20'])}) · 90일 고점 대비 {pc(tm_['dd90'])}")
    if trl: trl.append("- 기준: 단기는 EMA12와 EMA48의 위아래와 가격 위치, 중기는 50일 평균과 20일 평균의 위아래. 둘 다 같은 방향일 때만 그 방향으로 보고, 아니면 중립입니다. 참고 정보이며 진입 판정에는 쓰지 않습니다.")
    tr_title = "4. 단기·중기 추세 (참고)"
    shl = []
    for e in o.get("shock") or []:
        dirw = "급등" if e["up"] else "급락"
        if e["retrace"] >= 1: rw = f"{dirw}분을 모두 되돌림 (직전 가격보다 {'아래' if e['up'] else '위'})"
        elif e["retrace"] >= 0.5: rw = f"{dirw}분의 {e['retrace']*100:.0f}% 되돌림"
        elif e["retrace"] >= 0: rw = f"{dirw}분의 대부분 유지 ({e['retrace']*100:.0f}% 되돌림)"
        else: rw = f"{dirw} 방향으로 더 진행"
        shl.append(f"- {e['start_kst']}부터 {e['bars']}시간 {dirw}: {usd(e['pre'])} → {'고가' if e['up'] else '저가'} {usd(e['ext'])} ({pc(e['ext_pct'])}). 평소 1시간 등락은 {e['typical']*100:.1f}% 안팎")
        shl.append(f"- 지금 {usd(e['now'])} (직전 대비 {pc(e['now_pct'])}): {rw}")
    sh_title = "급변동 감지 (최근 24시간, 참고)"
    evs = (o.get("events") or {}).get("items", [])
    def when(h):
        if h < 0: return f"{-h:.0f}시간 전 발표"
        if h < 1: return "1시간 안"
        return f"{h:.0f}시간 뒤" if h < 48 else f"{h/24:.0f}일 뒤"
    star = lambda lv: "★" * lv
    ev_past = [e for e in evs if e["hours"] < 0]; ev_soon = [e for e in evs if 0 <= e["hours"] < 48]; ev_later = [e for e in evs if e["hours"] >= 48][:4]
    evl = []
    for e in ev_past: evl.append(f"- 방금: {e['kst']} {e['name']} {star(e['level'])} ({when(e['hours'])})")
    for e in ev_soon: evl.append(f"- 48시간 안: {e['kst']} {e['name']} {star(e['level'])} ({when(e['hours'])})")
    if not ev_soon: evl.append("- 앞으로 48시간 안에 예정된 주요 이벤트는 없습니다.")
    for e in ev_later: evl.append(f"- 이후: {e['kst']} {e['name']} {star(e['level'])} ({when(e['hours'])})")
    big_soon = [e for e in ev_soon if e["level"] >= 2 and e["hours"] < 24]
    ev_warn = ""
    if big_soon and (real or (lv and lv.get("proj", {}).get("signal"))):
        ev_warn = f"진입 신호가 걸린 상태에서 24시간 안에 {big_soon[0]['name']} 발표가 있습니다. 발표 전후로 크게 흔들릴 수 있습니다."
    ev_title = "예정 이벤트 (KST, 참고)"
    ev_note = "★이 많을수록 시장이 크게 움직인 적이 많은 일정입니다. 방향은 미리 알 수 없고, 진입 판정에는 쓰지 않습니다. 일정은 공식 발표 기준이며 바뀔 수 있습니다."
    sh_note = "1시간 봉 기준 참고 정보입니다. 진입 판정은 09시 일봉 종가로만 하므로, 되돌려진 급등락은 판정에 영향이 없습니다."
    plan = [f"- 시작 자금 {START_CAPITAL:,.0f} USDT, 기간 90일, 목표 잔고 {TARGET_BAL:,.0f} USDT" + (f" ({TARGET_NOTE})" if TARGET_NOTE else ""),
            f"- 시도당 최대 손실 {START_CAPITAL*RISK_FRAC:,.0f} USDT, 포지션은 잔고의 {LEV_CAP}배 이하",
            "- 처음 손절가는 투매 저점의 1% 아래, 이후 매일 09시에 추적 손절가로 올림",
            "- 손절되면 다음 진입 신호에 같은 방식으로 재진입"]
    ref = ["- 진입 판정과 추적 손절가는 09시 일봉 마감 때만 바뀝니다. 다른 시각 메일은 저점 이탈, 손절가 도달, 다음 판정 전망을 알립니다.",
           "- 백테스트(2023-09~2026-11, 겹치지 않는 90일 캠페인 8번): 목표 도달 3번, 2배 이상 1번, 소폭 수익 2번, 손실 2번(-73%, -37%). 연속 손절 5회 사례가 있습니다.",
           "- 가격은 Coinbase 현물 기준입니다. Bybit 선물과 저가가 조금 다를 수 있으니 손절가는 Bybit 차트로 확인하세요.",
           "- 권고 레버리지와 청산가는 격리 마진 기준의 어림값입니다. 실제 청산가는 주문 화면에서 확인하고, 손절가보다 아래인지 보세요.",
           f"- 수량은 잔고 {BALANCE:,.0f} USDT 기준입니다. 거래 후 잔고가 바뀌면 그 비율만큼 조정하세요.",
           "- 악재·호재 브리핑은 매일 " + ", ".join(f"{h:02d}시" for h in BRIEF_HOURS) + " 메일에 붙습니다.",
           f"- 실행 시각 {o['run_at_kst']} KST" + ("" if not o["errors"] else " / 수집 오류: " + "; ".join(o["errors"]))]
    foot = "정해진 규칙에 따른 자동 보고이며 매수·매도 권유가 아닙니다."
    # ── 텍스트 ──
    B = [f"■ 결론: {status}", head, "", "■ " + crit_title] + [f"{mark(ok)} {t}" for ok, t in crit] + [""]
    if size_title: B += ["■ " + size_title] + size_lines(z) + [""]
    B += ["■ 보유 중이라면: 추적 손절"] + trail + [""]
    if livel: B += ["■ 지금 (09시 이후 진행 중인 일봉)"] + livel + [""]
    if o.get("brief_due"): B += ["{{브리핑}}"]
    if shl: B += ["■ " + sh_title] + shl + ["{{뉴스}}", "- " + sh_note, ""]
    if evl: B += ["■ " + ev_title] + ([f"- ⚠ {ev_warn}"] if ev_warn else []) + evl + ["- " + ev_note, ""]
    if trl: B += ["■ " + tr_title] + trl + [""]
    if bxl: B += ["■ " + bx_title] + bxl + [""]
    if lml: B += ["■ " + lm_title] + lml + [""]
    if h4: B += ["■ 최근 4시간 봉 (OKX, 마감 시각 KST)"] + h4 + [""]
    B += ["■ 보조 지표 (진입 판정에는 쓰지 않음)"] + [f"{mark(ok)} {t}" for ok, t in aux] + ["", "{{해석}}", "", "■ 계획 요약"] + plan + ["", "■ 참고"] + ref + [""]
    views = o.get("views") or []
    vpx = o["h4"][0]["close"] if o.get("h4") else price
    vtime = o["h4"][0]["close_time"] if o.get("h4") else "현재"
    for n, v in enumerate(views, 1):
        B += [f"■ 별첨 {n}. 외부 의견: {v['author']} ({v['posted_kst'][5:].replace('-', '/')} 작성, {ago(v['age_days'])}) · 참고용, 검증되지 않은 의견"]
        B += [f"- {x}" for x in v.get("summary", [])]
        B += [f"  가격대 점검 (마지막 4시간 종가 {usd(vpx)}, {vtime} 마감 기준):"]
        B += [f"  {'▲' if r['pos'] == 'above' else '▼' if r['pos'] == 'below' else '●'} {r['name']}: {r['msg']} ({pc(r['gap'])})" for r in view_levels(v, vpx)]
        B += ["  우리 규칙과의 관계:"] + [f"  - {x}" for x in v.get("our_take", [])] + [f"  원문: {v['url']}", ""]
    B += [foot]
    text = "\n".join(B)
    # ── HTML ──
    fg, bg, bd = KIND[kind]
    hero = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-radius:12px;background:{bg};border:2px solid {bd}"><tr><td style="padding:16px 18px;{FONT}">'
            f'<div style="font-size:12px;font-weight:700;color:{fg}">1. 결론 · {esc(tag)}</div>'
            f'<div style="font-size:26px;font-weight:800;color:{fg};line-height:1.3;margin:2px 0 4px">{esc(status)}</div>'
            f'<div style="font-size:15px;color:#24292f;line-height:1.5">{esc(head)}</div>'
            f'<div style="font-size:13px;color:#57606a;margin-top:8px">현재가 <b style="color:#24292f">{usd(price)}</b></div></td></tr></table>')
    H = [hero]
    if size_title:
        if z and z["qty"] > 0:
            inner = tiles([("진입가", usd(z["entry"]), "현재가 기준" if abs(z["entry"] - price) < 1 else "규칙상 최고 진입가", "#24292f"),
                           ("손절가", usd(z["stop"]), f"진입가 대비 -{z['dist']*100:.1f}%", "#b3261e"),
                           ("권고 레버리지", f"{z['lev_set']}배", "격리 마진 설정값", "#3b4bc4"),
                           ("주문 금액", f"{z['notional']:,.0f} USDT", f"= {z['qty']:.3f} BTC · 잔고의 {z['lev']:.1f}배", "#24292f"),
                           ("증거금", f"약 {z['margin']:,.0f} USDT", f"잔고 {BALANCE:,.0f}의 {z['margin']/BALANCE*100:.0f}% · 청산가 약 {usd(z['liq'])}", "#24292f"),
                           ("손절 시 손실", f"약 {z['loss']:,.0f} USDT", f"잔고의 {z['loss']/BALANCE*100:.0f}%", "#b3261e")])
            extra = (" 12배 상한을 적용했습니다." if z["capped"] else "") + (" 청산가 여유를 위해 포지션을 줄였습니다." if z["shrunk"] else "")
            inner += f'<div style="font-size:12px;color:#57606a;margin-top:8px;line-height:1.5">{esc(size_lines(z)[4].lstrip("- ") + extra)}</div>'
        else: inner = ul(size_lines(z))
        if real: H.append(card("2. " + esc(size_title), inner, border="#34a853", bg="#f6fbf7", tcolor="#0f7b3f", thick=True))
        else: H.append(card("2. " + esc(size_title), inner, border="#c7ced6", bg="#fafbfc", tcolor="#57606a"))
    tinner = (f'<div style="font-size:12px;color:#57606a">오늘의 추적 손절가</div><div style="font-size:26px;font-weight:800;color:#24292f;line-height:1.3">{usd(d["trail_stop"])}</div>'
              f'<div style="font-size:12px;color:#57606a;margin-bottom:8px">최근 {TRAIL_DAYS}일 최저가 {usd(d["trail_low"])}의 1% 아래</div>'
              f'<div style="font-size:14px;color:#24292f;line-height:1.55">{esc(trail[1].lstrip("- "))}</div>')
    if trail_hit is not None:
        c1, c2 = ("#b3261e", "#fdecea") if trail_hit else ("#0f7b3f", "#e6f4ea")
        tinner += f'<div style="font-size:14px;font-weight:600;color:{c1};background:{c2};border-radius:8px;padding:8px 10px;margin-top:10px;line-height:1.5">{esc(trail_msg)}</div>'
    H.append(card("3. 보유 중이라면: 추적 손절", tinner, border="#6e7ff3", bg="#f7f8ff", tcolor="#3b4bc4", thick=True))
    H.append(card(esc(crit_title), checks(crit)))
    if livel: H.append(card("지금 (09시 이후 진행 중인 일봉)", ul(livel)))
    if o.get("brief_due"): H.append("<!--BRIEF-->")
    if shl:
        sfg, sbg, sbd = KIND["far"]
        H.append(card(sh_title, ul(shl) + "<!--NEWS-->" + ul([sh_note], 12, "#57606a"), border=sbd, bg="#fffaf0", tcolor=sfg))
    if evl:
        def evrow(e, tag, c):
            bold = "font-weight:700;" if e["level"] >= 3 else ""
            return (f'<tr><td valign="top" style="padding:4px 8px 4px 0;{FONT};font-size:12px;white-space:nowrap;color:{c};font-weight:700">{tag}</td>'
                    f'<td valign="top" style="padding:4px 8px 4px 0;{FONT};font-size:13px;white-space:nowrap;color:#57606a">{esc(e["kst"])}</td>'
                    f'<td style="padding:4px 0;{FONT};font-size:13px;color:#24292f;{bold}line-height:1.45">{esc(e["name"])} <span style="color:#e0a100">{star(e["level"])}</span>'
                    f'<br><span style="font-size:12px;color:#57606a;font-weight:400">{when(e["hours"])}</span></td></tr>')
        rows = "".join(evrow(e, "방금", "#57606a") for e in ev_past) + "".join(evrow(e, "48h 안", "#b3261e") for e in ev_soon)
        if not ev_soon: rows += f'<tr><td colspan="3" style="padding:4px 0;{FONT};font-size:13px;color:#0f7b3f">앞으로 48시간 안에 예정된 주요 이벤트는 없습니다.</td></tr>'
        rows += "".join(evrow(e, "이후", "#8b949e") for e in ev_later)
        ein = (f'<div style="font-size:14px;font-weight:600;color:#b3261e;background:#fdecea;border-radius:8px;padding:8px 10px;margin:0 0 8px;line-height:1.5">{esc(ev_warn)}</div>' if ev_warn else "")
        ein += f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>' + ul([ev_note], 12, "#57606a")
        H.append(card(ev_title, ein))
    if trl:
        def pill(t):
            c = {"상승": ("#0f7b3f", "#e6f4ea"), "하락": ("#b3261e", "#fdecea"), "중립": ("#57606a", "#f1f3f5")}[t]
            return f'<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:{c[1]};color:{c[0]};font-weight:700;font-size:13px">{t}</span>'
        tin = ""
        if ts_: tin += f'<div style="font-size:14px;color:#24292f;line-height:1.7">단기 (며칠) {pill(ts_["dir"])} <span style="color:#57606a;font-size:12px">{esc(trl[0].split("· ",1)[1] if "· " in trl[0] else "")}</span></div>'
        if tm_: tin += f'<div style="font-size:14px;color:#24292f;line-height:1.7">중기 (몇 주) {pill(tm_["dir"])} <span style="color:#57606a;font-size:12px">{esc(trl[1].split("· ",1)[1] if "· " in trl[1] else "")}</span></div>'
        if (o.get("charts") or {}).get("trend"): tin += '<img src="cid:chart_trend" alt="추세 차트" width="100%" style="display:block;width:100%;max-width:568px;height:auto;margin:10px 0 6px;border-radius:8px">'
        tin += ul(trl[2:], 12, "#57606a")
        H.append(card(tr_title, tin))
    if bx:
        bfg, bbg, bbd = KIND[bx_kind]
        if bx["valid"]:
            p_ = max(0, min(1, bx["pos"]))
            bar = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr>'
                   f'<td style="font-size:12px;color:#57606a;white-space:nowrap;padding-right:6px">{usd(bx["lo"])}</td>'
                   f'<td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#e6f4ea;height:12px;border-radius:6px" width="{int(p_*100)}%"></td><td style="background:#eceff3;height:12px;border-radius:6px"></td></tr></table></td>'
                   f'<td style="font-size:12px;color:#57606a;white-space:nowrap;padding-left:6px">{usd(bx["hi"])}</td></tr></table>'
                   f'<div style="font-size:12px;color:#57606a">현재 위치 {bx["pos"]*100:.0f}% · 중간 {usd(bx["mid"])} · 폭 {bx["w"]*100:.1f}%</div>')
            bin_ = (f'<div style="font-size:15px;font-weight:700;color:{bfg};line-height:1.5">{esc(bx_head)}</div>' + bar)
            if bx_size:
                bin_ += tiles([("진입가", usd(bx_size["entry"]), "마지막 4시간 종가", "#24292f"), ("손절가", usd(bx_size["stop"]), f"하단 3% 아래 (-{bx_size['dist']*100:.1f}%)", "#b3261e"),
                               ("1차 목표", usd(bx_size["tgt"]), f"박스 중간 · 손익비 {bx_size['rr']:.1f}", "#0f7b3f"),
                               ("수량", f"{bx_size['qty']:.3f} BTC", f"{bx_size['notional']:,.0f} USDT · 잔고의 {bx_size['lev']:.1f}배 · 손실 한도 {bx_size['risk']:,.0f}", "#24292f")])
            if (o.get("charts") or {}).get("box"): bin_ += '<img src="cid:chart_box" alt="박스 차트" width="100%" style="display:block;width:100%;max-width:568px;height:auto;margin:10px 0 6px;border-radius:8px">'
            bin_ += ul([bxl[-1]], 12, "#57606a")
            H.append(card(bx_title, bin_, border=bbd, bg=bbg if bx_kind != "wait" else "#ffffff", tcolor=bfg, thick=bx_kind in ("go", "void")))
        else:
            nb = f'<div style="font-size:14px;color:#24292f;line-height:1.55">박스 아님 · 20일 저점 {usd(bx["lo"])} ~ 고점 {usd(bx["hi"])}, 폭 {bx["w"]*100:.0f}%</div>'
            if (o.get("charts") or {}).get("box"): nb += '<img src="cid:chart_box" alt="박스 차트" width="100%" style="display:block;width:100%;max-width:568px;height:auto;margin:10px 0 6px;border-radius:8px">'
            H.append(card(bx_title, nb + ul(bxl[1:], 12, "#57606a")))
    if lm:
        rows = [("위", b, "#0f7b3f", "숏 청산") for b in reversed(lm["above"])] + [("아래", b, "#b3261e", "롱 청산") for b in lm["below"]]
        mx = max([b["usd"] for _, b, _, _ in rows] + [1])
        bars = "".join(
            f'<tr><td style="padding:3px 0;{FONT};font-size:13px;color:#24292f;white-space:nowrap">{side} {usd(b["lo"])}~{usd(b["hi"])} <span style="color:#57606a">({pc(b["mid"])})</span></td>'
            f'<td width="38%" style="padding:3px 0 3px 8px"><table role="presentation" width="{max(4, round(b["usd"]/mx*100))}%" cellpadding="0" cellspacing="0"><tr><td style="background:{col};height:10px;border-radius:3px;font-size:1px;line-height:1px">&nbsp;</td></tr></table></td>'
            f'<td align="right" style="padding:3px 0 3px 8px;{FONT};font-size:13px;color:{col};font-weight:600;white-space:nowrap">{m(b["usd"])}</td></tr>'
            for side, b, col, _ in rows)
        inner = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{bars}</table>'
                 f'<div style="font-size:12px;color:#57606a;margin-top:8px;line-height:1.5">초록은 위쪽 숏 청산, 빨강은 아래쪽 롱 청산 추정 금액입니다.</div>' + ul(lml[-2:], 12, "#57606a"))
        H.append(card(lm_title, inner))
    H.append("<!--NOTE-->")
    if h4: H.append(card("최근 4시간 봉 (OKX, 마감 시각 KST)", ul(h4, 13)))
    H.append(card("보조 지표 (진입 판정에는 쓰지 않음)", checks(aux)))
    H.append(card("계획 요약", ul(plan, 13)))
    H.append(card("참고", ul(ref, 12, "#57606a"), bg="#fafbfc"))
    for n, v in enumerate(views, 1):
        sty = {"above": ("#0f7b3f", "#e6f4ea", "▲ 위"), "below": ("#b3261e", "#fdecea", "▼ 아래"), "inside": ("#8a5a00", "#fff4d6", "● 안")}
        rows = ""; placed = False
        for r in view_levels(v, vpx):
            if not placed and vpx > r["hi"]:
                rows += (f'<tr><td colspan="2" style="padding:6px 0;{FONT};font-size:13px;font-weight:700;color:#3b4bc4;border-top:2px dashed #6e7ff3;border-bottom:2px dashed #6e7ff3">'
                         f'지금 {usd(vpx)} ({esc(vtime)} 마감 4시간 종가)</td></tr>'); placed = True
            c, bgc, lab = sty[r["pos"]]
            rows += (f'<tr><td valign="top" style="padding:6px 8px 6px 0;{FONT};white-space:nowrap"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:{bgc};color:{c};font-weight:700;font-size:12px">{lab}</span></td>'
                     f'<td style="padding:6px 0;{FONT};font-size:13px;color:#24292f;line-height:1.5"><b>{esc(r["name"])}</b> <span style="color:#57606a">({pc(r["gap"])})</span><br>{esc(r["msg"])}</td></tr>')
        if not placed:
            rows += f'<tr><td colspan="2" style="padding:6px 0;{FONT};font-size:13px;font-weight:700;color:#3b4bc4;border-top:2px dashed #6e7ff3">지금 {usd(vpx)} ({esc(vtime)} 마감 4시간 종가)</td></tr>'
        vin = (f'<div style="font-size:12px;color:#57606a;margin:0 0 8px">{esc(v["posted_kst"][5:].replace("-", "/"))} 작성 · {ago(v["age_days"])} · 참고용이며 검증되지 않은 의견입니다. 진입 판정에는 쓰지 않습니다.</div>'
               + ul(v.get("summary", []), 14)
               + f'<div style="font-size:12px;font-weight:700;color:#57606a;margin:12px 0 2px">가격대 점검</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'
               + f'<div style="font-size:12px;font-weight:700;color:#57606a;margin:12px 0 4px">우리 규칙과의 관계</div>' + ul(v.get("our_take", []), 13, "#24292f")
               + f'<div style="font-size:12px;margin-top:8px"><a href="{esc(v["url"])}" style="color:#3b4bc4">원문 보기</a></div>')
        H.append(card(f"별첨 {n}. 외부 의견 · {esc(v['author'])}", vin, border="#c9b8f0", bg="#faf8ff", tcolor="#6b3fc4"))
    H.append(f'<div style="{FONT};font-size:12px;color:#8b949e;text-align:center;margin:4px 0 0">{esc(foot)}</div>')
    doc = (f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
           f'<body style="margin:0;padding:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:16px 10px">'
           f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td>{"".join(H)}</td></tr></table></td></tr></table></body></html>')
    return subject, text, doc

def parse_brief(txt):
    """brief.txt: [악재] [호재] [일정] [요약] 구역, 항목은 '- 제목 | 설명 | URL' (설명·URL 생략 가능)."""
    sec = {"악재": [], "호재": [], "일정": [], "요약": []}; cur = None
    for line in txt.splitlines():
        line = line.strip()
        m = re.match(r"^\[(악재|호재|일정|요약)\]", line)
        if m: cur = m.group(1); continue
        if not cur or not line.startswith("-"): continue
        parts = [x.strip() for x in line.lstrip("- ").split("|")]
        url = parts[-1] if parts[-1].startswith("https://") else ""
        if url: parts = parts[:-1]
        title = parts[0] if parts else ""; desc = " ".join(parts[1:]) if len(parts) > 1 else ""
        if title and len(sec[cur]) < {"악재": 5, "호재": 5, "일정": 3, "요약": 2}[cur]: sec[cur].append((title[:120], desc[:240], url))
    return sec

def render_brief(sec, stamp):
    """(텍스트, HTML)."""
    if not any(sec.values()):
        msg = "오늘의 악재·호재 브리핑을 만들지 못했습니다."
        return f"■ 오늘의 악재·호재\n- {msg}\n\n", card("오늘의 악재·호재", ul([msg], 13, "#57606a"))
    T = [f"■ 오늘의 악재·호재 ({stamp} 기준, 판단 참고용)"]
    for k, lab in (("요약", "요약"), ("악재", "악재"), ("호재", "호재"), ("일정", "볼 일정")):
        for t, d, u in sec[k]: T.append(f"- {lab}: {t}" + (f". {d}" if d else "") + (f" ({u})" if u else ""))
    T.append("- 기사 내용을 모은 것이며, 진입 판정에는 쓰지 않습니다. 판단은 직접 하세요.")
    def items(rows, col):
        return "".join(f'<div style="margin:0 0 8px;{FONT}"><div style="font-size:14px;font-weight:700;color:{col};line-height:1.45">{esc(t)}</div>'
                       + (f'<div style="font-size:13px;color:#24292f;line-height:1.5">{esc(d)}' if d else '<div style="font-size:13px">')
                       + (f' <a href="{esc(u)}" style="color:#3b4bc4;font-size:12px">출처</a>' if u else "") + "</div></div>" for t, d, u in rows)
    h = ""
    if sec["요약"]: h += "".join(f'<div style="font-size:14px;color:#24292f;line-height:1.55;background:#f6f8fa;border-radius:8px;padding:8px 10px;margin:0 0 10px">{esc(t + (". " + d if d else ""))}</div>' for t, d, u in sec["요약"])
    h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
    h += f'<td width="50%" valign="top" style="padding:0 8px 0 0"><div style="font-size:12px;font-weight:800;color:#b3261e;margin:0 0 6px">▼ 악재</div>{items(sec["악재"], "#b3261e") or "<div style=font-size:13px>없음</div>"}</td>'
    h += f'<td width="50%" valign="top" style="padding:0 0 0 8px;border-left:1px solid #eaeef2"><div style="font-size:12px;font-weight:800;color:#0f7b3f;margin:0 0 6px">▲ 호재</div>{items(sec["호재"], "#0f7b3f") or "<div style=font-size:13px>없음</div>"}</td>'
    h += "</tr></table>"
    if sec["일정"]: h += '<div style="font-size:12px;font-weight:700;color:#57606a;margin:8px 0 4px">볼 일정</div>' + items(sec["일정"], "#3b4bc4")
    h += ul(["기사 내용을 모은 것이며, 진입 판정에는 쓰지 않습니다. 판단은 직접 하세요."], 12, "#57606a")
    return "\n".join(T) + "\n\n", card(f"오늘의 악재·호재 ({esc(stamp)} 기준, 판단 참고용)", h, border="#8b9cf7", bg="#ffffff", tcolor="#3b4bc4", thick=True)

def send(wd, note_path=None, prefix=""):
    load_config(wd)
    flag = os.path.join(wd, "sent.json")
    if os.path.exists(flag): print("이미 발송됨:", open(flag).read()); return
    st = json.load(open(os.path.join(wd, "state.json"))); body = open(os.path.join(wd, "draft.txt")).read()
    doc = open(os.path.join(wd, "draft.html")).read()
    clean = lambda x: re.sub(r"[\ufffd\x00-\x08\x0b-\x1f\x7f]", "", x)          # 모델이 쓴 글에서 깨진 글자·제어 문자 제거
    note = clean(open(note_path, encoding="utf-8", errors="replace").read()).strip() if note_path and os.path.exists(note_path) else ""
    body = body.replace("{{해석}}\n\n", ("■ 해석\n" + note + "\n\n") if note else "")
    doc = doc.replace("<!--NOTE-->", card("해석", ul([x for x in note.splitlines() if x.strip()])) if note else "")
    # 급변동 원인 뉴스: <작업폴더>/news.txt, 한 줄에 "- 요약 | 출처 URL" (최대 3줄). 없으면 자리만 지운다
    nf = os.path.join(wd, "news.txt"); news = []
    if os.path.exists(nf):
        for x in clean(open(nf, encoding="utf-8", errors="replace").read()).splitlines()[:3]:
            x = x.strip().lstrip("- ").strip()
            if not x: continue
            t, _, u = x.partition("|"); t, u = t.strip(), u.strip()
            news.append((t, u if u.startswith("https://") else ""))
    body = body.replace("{{뉴스}}\n", "".join(f"- 원인 뉴스: {t}" + (f" ({u})" if u else "") + "\n" for t, u in news))
    nh = "".join(f'<div style="font-size:14px;color:#24292f;line-height:1.55;margin:6px 0 4px">원인 뉴스: {esc(t)}'
                 + (f' <a href="{esc(u)}" style="color:#3b4bc4;font-size:12px">출처</a>' if u else "") + "</div>" for t, u in news)
    doc = doc.replace("<!--NEWS-->", nh)
    if st.get("brief_due"):                                     # 악재·호재 브리핑: <작업폴더>/brief.txt
        bf = os.path.join(wd, "brief.txt")
        sec = parse_brief(clean(open(bf, encoding="utf-8", errors="replace").read())) if os.path.exists(bf) else {"악재": [], "호재": [], "일정": [], "요약": []}
        bt, bh = render_brief(sec, st["run_at_kst"][5:].replace("-", "/"))
        body = body.replace("{{브리핑}}\n", bt); doc = doc.replace("<!--BRIEF-->", bh)
    import base64
    atts = []
    for k in ("trend", "box"):
        fp = os.path.join(wd, f"chart_{k}.png")
        if os.path.exists(fp) and f"cid:chart_{k}" in doc:
            atts.append({"filename": f"chart_{k}.png", "content": base64.b64encode(open(fp, "rb").read()).decode(), "content_id": f"chart_{k}", "content_type": "image/png"})
    payload = os.path.join(wd, "mail.json")
    msg = {"from": MAIL_FROM, "to": [MAIL_TO], "subject": prefix + st["subject"], "text": body, "html": doc}
    if atts: msg["attachments"] = atts
    json.dump(msg, open(payload, "w"), ensure_ascii=False)
    open(os.path.join(wd, "final.html"), "w").write(doc)
    r = subprocess.run(["curl", "-sS", "-m", "30", "-w", "\nHTTP %{http_code}", "-X", "POST", "https://api.resend.com/emails",
                        "-H", "Content-Type: application/json", "--data-binary", "@" + payload], capture_output=True, text=True)
    print(r.stdout, r.stderr)
    if "HTTP 200" not in r.stdout and atts and "HTTP 4" in r.stdout:      # 첨부가 거부되면 그림 없이 한 번 더
        msg.pop("attachments"); msg["html"] = re.sub(r'<img src="cid:[^"]+"[^>]*>', "", doc)
        json.dump(msg, open(payload, "w"), ensure_ascii=False)
        r = subprocess.run(["curl", "-sS", "-m", "30", "-w", "\nHTTP %{http_code}", "-X", "POST", "https://api.resend.com/emails",
                            "-H", "Content-Type: application/json", "--data-binary", "@" + payload], capture_output=True, text=True)
        print("재시도(첨부 없이):", r.stdout, r.stderr)
    if "HTTP 200" in r.stdout: open(flag, "w").write(r.stdout)
    else: sys.exit(1)

if __name__ == "__main__":
    cmd, wd = sys.argv[1], sys.argv[2]
    if cmd == "collect": collect(wd)
    else: send(wd, sys.argv[3] if len(sys.argv) > 3 else None, sys.argv[4] if len(sys.argv) > 4 else "")
