export function printHtml(opts: { title: string; html: string; pageSize?: "A4" | "receipt" }) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=520,height=720");
  if (!w) return;

  const pageCss = opts.pageSize === "receipt"
    ? "@page{size:80mm auto;margin:8mm;}"
    : "@page{size:A4;margin:12mm;}";

  w.document.open();
  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<style>
${pageCss}
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; color:#0f172a;}
h1,h2,h3{margin:0}
.small{font-size:12px;color:#475569}
hr{border:0;border-top:1px dashed #cbd5e1;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:6px 0;vertical-align:top}
th{text-align:left;color:#334155;border-bottom:1px solid #e2e8f0}
.text-right{text-align:right}
.text-center{text-align:center}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,monospace}
</style>
</head>
<body>
${opts.html}
<script>
  window.focus();
  window.print();
  window.onafterprint = () => window.close();
</script>
</body>
</html>`);
  w.document.close();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
