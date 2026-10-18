(() => {
  const { geoNaturalEarth1, geoPath, feature } = MapLibs;
  const $ = (id) => document.getElementById(id),
    NS = "http://www.w3.org/2000/svg";
  const S = { pol: null, pod: null, hover: null };
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const sv = (tag, a) => {
    const e = document.createElementNS(NS, tag);
    for (const k in a) e.setAttribute(k, a[k]);
    return e;
  };
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4);
  const iso = (d) => d.toISOString().slice(0, 10);
  $("start").value = iso(today);
  $("end").value = iso(new Date(+today + 60 * 864e5));
  $("pw").value = sessionStorage.getItem("pw") || "";

  Promise.all([
    fetch("data/ports.json").then((r) => r.json()),
    fetch("data/world-110m.json").then((r) => r.json()),
  ]).then(([ports, world]) => {
    const proj = geoNaturalEarth1()
        .rotate([-140, 0])
        .fitSize([960, 500], { type: "Sphere" }),
      path = geoPath(proj),
      map = $("map");
    for (const f of feature(world, world.objects.countries).features) {
      const p = sv("path", { d: path(f) || "", class: "country" });
      p.dataset.id = String(f.id);
      map.append(p);
    }
    const els = ports.map((p) => {
      const [x, y] = proj([p.lon, p.lat]),
        g = sv("g", { class: "port" });
      const t = sv("text", {
        x: x + p.dx,
        y: y + p.dy,
        "text-anchor": p.anchor,
      });
      t.textContent = p.name;
      g.append(
        sv("circle", { class: "dot", cx: x, cy: y, r: 5 }),
        sv("circle", { class: "hit", cx: x, cy: y, r: 11 }),
        t,
      );
      g.onmouseenter = () => {
        S.hover = p;
        draw();
      };
      g.onmouseleave = () => {
        S.hover = null;
        draw();
      };
      g.onclick = () => pick(p);
      map.append(g);
      return [p, g];
    });
    function draw() {
      for (const c of map.querySelectorAll(".country"))
        c.classList.toggle(
          "hl",
          !!S.hover && c.dataset.id === S.hover.countryId,
        );
      for (const [p, g] of els) {
        g.classList.toggle("hover", p === S.hover);
        g.classList.toggle("pol", p === S.pol);
        g.classList.toggle("pod", p === S.pod);
      }
      $("pol").textContent = S.pol
        ? `${S.pol.name} (${S.pol.id})`
        : "地図で選択";
      $("pod").textContent = S.pod
        ? `${S.pod.name} (${S.pod.id})`
        : "地図で選択";
      $("go").disabled = !(S.pol && S.pod);
    }
    function pick(p) {
      if (!S.pol || S.pod) {
        S.pol = p;
        S.pod = null;
      } else if (p === S.pol) S.pol = null;
      else S.pod = p;
      draw();
    }
    $("reset").onclick = () => {
      S.pol = S.pod = null;
      $("results").replaceChildren();
      note();
      draw();
    };
    draw();
  });

  function note(msg, err) {
    const n = $("notice");
    n.hidden = !msg;
    n.textContent = msg || "";
    n.className = err ? "err" : "";
  }
  const fmt = (s) => {
    const m =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})\S*?(Z|[+-]\d{2}:\d{2})?$/.exec(
        s || "",
      );
    return m ? `${m[1]} ${m[2]} (${m[3] || ""})` : s || "—";
  };
  function summarize(r) {
    const legs = r.legs || [],
      v = legs.filter((l) => l.transport?.modeOfTransport === "VESSEL");
    const a = v[0] || legs[0],
      b = v[v.length - 1] || legs[legs.length - 1],
      sp = a?.transport?.servicePartners?.[0];
    return {
      etd: a?.departure?.dateTime,
      eta: b?.arrival?.dateTime,
      days: r.transitTime,
      vessels: v.map((l) => l.transport.vessel?.name).filter(Boolean),
      voyage: sp?.carrierExportVoyageNumber,
      service: sp?.carrierServiceCode || sp?.carrierServiceName,
      ts: Math.max(v.length - 1, 0),
      cuts: r.cutOffTimes || [],
    };
  }
  $("go").onclick = async () => {
    const pw = $("pw").value;
    sessionStorage.setItem("pw", pw);
    note("検索中…");
    $("results").replaceChildren();
    const q = new URLSearchParams({ from: S.pol.id, to: S.pod.id });
    if ($("start").value) q.set("start", $("start").value);
    if ($("end").value) q.set("end", $("end").value);
    try {
      const res = await fetch(
        `${CONFIG.API_BASE.replace(/\/$/, "")}/api/routes?${q}`,
        { headers: { Authorization: `Bearer ${pw}` } },
      );
      if (res.status === 401) return note("パスワードが違います", true);
      if (!res.ok) return note(`取得に失敗しました (${res.status})`, true);
      const rows = (await res.json())
        .map(summarize)
        .sort((x, y) => Date.parse(x.etd) - Date.parse(y.etd));
      note(
        (res.headers.get("X-Upstream-Host") || "").includes("swaggerhub")
          ? "⚠ モックのダミーデータです（実際のスケジュールではありません）"
          : rows.length
            ? ""
            : "該当するスケジュールがありません",
      );
      $("results").replaceChildren(
        ...rows.map((s) => {
          const c = el("div", null, "card");
          c.append(
            el(
              "div",
              `${fmt(s.etd)} → ${fmt(s.eta)}${s.days != null ? `  / ${s.days}日` : ""}`,
              "t",
            ),
            el(
              "div",
              `${s.vessels.join(" + ") || "船名なし"} ${s.voyage || ""} ${s.service ? `[${s.service}]` : ""} ${s.ts ? `T/S ${s.ts}回` : "直行"}`,
              "s",
            ),
          );
          for (const k of s.cuts)
            c.append(
              el(
                "div",
                `${k.cutOffDateTimeCode}: ${fmt(k.cutOffDateTime)}`,
                "s",
              ),
            );
          return c;
        }),
      );
    } catch {
      note(
        "通信に失敗しました（Worker URLとCORS設定を確認してください）",
        true,
      );
    }
  };
})();
