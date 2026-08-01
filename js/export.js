function triggerDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function profilesToCSV(profiles) {
  if (!profiles.length) return "";
  const cols = Object.keys(profiles[0]);
  const lines = [cols.map(csvEscape).join(",")];
  for (const p of profiles) lines.push(cols.map((c) => csvEscape(p[c])).join(","));
  return lines.join("\n");
}

function profilesToJSON(profiles) {
  return JSON.stringify(profiles, null, 2);
}

window.EXPORTS = { triggerDownload, profilesToCSV, profilesToJSON };
