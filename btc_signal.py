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
MAIL_FROM = "BTC 점검 <onboarding@resend.dev>"

def load_config(wd):
    global START_CAPITAL, BALANCE, TARGET_BAL, TARGET_NOTE, MAIL_TO
    c = json.load(open(os.path.join(wd, "config.json")))
    START_CAPITAL = float(c["start_capital"]); BALANCE = float(c.get("balance", START_CAPITAL))
    TARGET_BAL = float(c["target_balance"]); TARGET_NOTE = c.get("target_note", ""); MAIL_TO = c["mail_to"]

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

    # 2) 4시간 봉 (OKX BTC-USDT 현물)
    try:
        rows = json.loads(get("https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=4H&limit=8"))["data"]
        closed = [r for r in rows if r[8] == "1"][:6]
        out["h4"] = [dict(close_time=dt.datetime.fromtimestamp(int(r[0])/1000 + 14400, KST).strftime("%m/%d %H:%M"),
                          open=float(r[1]), high=float(r[2]), low=float(r[3]), close=float(r[4])) for r in closed]
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

    out["errors"] = err
    subject, body, doc = compose(out)
    out["subject"] = subject
    os.makedirs(wd, exist_ok=True)
    json.dump(out, open(os.path.join(wd, "state.json"), "w"), ensure_ascii=False, indent=1)
    open(os.path.join(wd, "draft.txt"), "w").write(body)
    open(os.path.join(wd, "draft.html"), "w").write(doc)
    print("SUBJECT:", subject); print(body); print("\n--- state.json ---"); print(json.dumps(out, ensure_ascii=False))

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
    elif lv: size_title, z = f"조건이 채워지면 (예상: 저점 {usd(lv['proj']['low'])} 유지, 지금 가격에 진입한다고 가정)", sizing(price, lv["proj"]["low"]*0.99)
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
    plan = [f"- 시작 자금 {START_CAPITAL:,.0f} USDT, 기간 90일, 목표 잔고 {TARGET_BAL:,.0f} USDT" + (f" ({TARGET_NOTE})" if TARGET_NOTE else ""),
            f"- 시도당 최대 손실 {START_CAPITAL*RISK_FRAC:,.0f} USDT, 포지션은 잔고의 {LEV_CAP}배 이하",
            "- 처음 손절가는 투매 저점의 1% 아래, 이후 매일 09시에 추적 손절가로 올림",
            "- 손절되면 다음 진입 신호에 같은 방식으로 재진입"]
    ref = ["- 진입 판정과 추적 손절가는 09시 일봉 마감 때만 바뀝니다. 다른 시각 메일은 저점 이탈, 손절가 도달, 다음 판정 전망을 알립니다.",
           "- 백테스트(2023-09~2026-11, 겹치지 않는 90일 캠페인 8번): 목표 도달 3번, 2배 이상 1번, 소폭 수익 2번, 손실 2번(-73%, -37%). 연속 손절 5회 사례가 있습니다.",
           "- 가격은 Coinbase 현물 기준입니다. Bybit 선물과 저가가 조금 다를 수 있으니 손절가는 Bybit 차트로 확인하세요.",
           "- 권고 레버리지와 청산가는 격리 마진 기준의 어림값입니다. 실제 청산가는 주문 화면에서 확인하고, 손절가보다 아래인지 보세요.",
           f"- 수량은 잔고 {BALANCE:,.0f} USDT 기준입니다. 거래 후 잔고가 바뀌면 그 비율만큼 조정하세요.",
           f"- 실행 시각 {o['run_at_kst']} KST" + ("" if not o["errors"] else " / 수집 오류: " + "; ".join(o["errors"]))]
    foot = "정해진 규칙에 따른 자동 보고이며 매수·매도 권유가 아닙니다."
    # ── 텍스트 ──
    B = [f"■ 결론: {status}", head, "", "■ " + crit_title] + [f"{mark(ok)} {t}" for ok, t in crit] + [""]
    if size_title: B += ["■ " + size_title] + size_lines(z) + [""]
    B += ["■ 보유 중이라면: 추적 손절"] + trail + [""]
    if livel: B += ["■ 지금 (09시 이후 진행 중인 일봉)"] + livel + [""]
    if lml: B += ["■ " + lm_title] + lml + [""]
    if h4: B += ["■ 최근 4시간 봉 (OKX, 마감 시각 KST)"] + h4 + [""]
    B += ["■ 보조 지표 (진입 판정에는 쓰지 않음)"] + [f"{mark(ok)} {t}" for ok, t in aux] + ["", "{{해석}}", "", "■ 계획 요약"] + plan + ["", "■ 참고"] + ref + ["", foot]
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
            inner = tiles([("진입가", usd(z["entry"]), "현재가 기준", "#24292f"),
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
    H.append(f'<div style="{FONT};font-size:12px;color:#8b949e;text-align:center;margin:4px 0 0">{esc(foot)}</div>')
    doc = (f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
           f'<body style="margin:0;padding:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:16px 10px">'
           f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td>{"".join(H)}</td></tr></table></td></tr></table></body></html>')
    return subject, text, doc

def send(wd, note_path=None, prefix=""):
    load_config(wd)
    flag = os.path.join(wd, "sent.json")
    if os.path.exists(flag): print("이미 발송됨:", open(flag).read()); return
    st = json.load(open(os.path.join(wd, "state.json"))); body = open(os.path.join(wd, "draft.txt")).read()
    doc = open(os.path.join(wd, "draft.html")).read()
    note = open(note_path).read().strip() if note_path and os.path.exists(note_path) else ""
    body = body.replace("{{해석}}\n\n", ("■ 해석\n" + note + "\n\n") if note else "")
    doc = doc.replace("<!--NOTE-->", card("해석", ul([x for x in note.splitlines() if x.strip()])) if note else "")
    payload = os.path.join(wd, "mail.json")
    json.dump({"from": MAIL_FROM, "to": [MAIL_TO], "subject": prefix + st["subject"], "text": body, "html": doc}, open(payload, "w"), ensure_ascii=False)
    open(os.path.join(wd, "final.html"), "w").write(doc)
    r = subprocess.run(["curl", "-sS", "-m", "30", "-w", "\nHTTP %{http_code}", "-X", "POST", "https://api.resend.com/emails",
                        "-H", "Content-Type: application/json", "--data-binary", "@" + payload], capture_output=True, text=True)
    print(r.stdout, r.stderr)
    if "HTTP 200" in r.stdout: open(flag, "w").write(r.stdout)
    else: sys.exit(1)

if __name__ == "__main__":
    cmd, wd = sys.argv[1], sys.argv[2]
    if cmd == "collect": collect(wd)
    else: send(wd, sys.argv[3] if len(sys.argv) > 3 else None, sys.argv[4] if len(sys.argv) > 4 else "")
