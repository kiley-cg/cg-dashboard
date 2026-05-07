// Daily morning CSR-performance digest. Renders a self-contained HTML
// email from the latest snapshot and sends via Resend's REST API.

import { Resend } from "resend";
import { ISSUE_KINDS, type IssueKind } from "@/lib/syncore/followups";
import type { CsrMetrics } from "../../../app/(app)/dashboard/_lib/compute";

const ISSUE_LABEL: Record<IssueKind, string> = {
  artwork: "Artwork",
  backOrder: "Back Order",
  development: "Development",
  hold: "Hold",
  inProduction: "In Production",
  inTransit: "In Transit",
  needsTracking: "Needs Tracking",
  postDelivery: "Post Delivery",
  problem: "Problem",
  waiting: "Waiting",
  none: "None",
};

interface SendResult {
  ok: boolean;
  skipped?: string;
  id?: string;
  error?: string;
}

function recipients(): string[] {
  const raw = process.env.DIGEST_RECIPIENTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fromAddress(): string {
  return (
    process.env.DIGEST_FROM_EMAIL ?? "alerts@colorgraphicswa.com"
  );
}

export async function sendCsrDigest(args: {
  metrics: CsrMetrics[];
  todayPacific: string;
  dashboardUrl: string;
}): Promise<SendResult> {
  const to = recipients();
  if (to.length === 0) {
    return { ok: false, skipped: "DIGEST_RECIPIENTS not configured" };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: "RESEND_API_KEY not configured" };
  }

  const subject = buildSubject(args.metrics, args.todayPacific);
  const html = renderHtml(args);
  const text = renderText(args);

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
      text,
    });
    if (result.error) {
      return { ok: false, error: result.error.message ?? "Resend error" };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function buildSubject(metrics: CsrMetrics[], today: string): string {
  const totalOverdue = metrics.reduce((n, m) => n + m.overdue, 0);
  const totalCritStale = metrics.reduce((n, m) => n + m.staleCriticalRush, 0);
  const status =
    totalOverdue + totalCritStale === 0
      ? "all clear"
      : `${totalOverdue} overdue · ${totalCritStale} stale crit/rush`;
  return `CSR Dashboard · ${today} · ${status}`;
}

function renderText(args: {
  metrics: CsrMetrics[];
  todayPacific: string;
  dashboardUrl: string;
}): string {
  const lines: string[] = [];
  lines.push(`CSR Performance · ${args.todayPacific}`);
  lines.push("");
  for (const m of args.metrics) {
    lines.push(`${m.csrName}`);
    lines.push(`  Attention score: ${m.headlineKpi} (lower is better)`);
    lines.push(`  Workload: ${m.workload}`);
    lines.push(`  Due today: ${m.dueToday}`);
    lines.push(`  Overdue: ${m.overdue}`);
    lines.push(`  Critical / Critical Rush: ${m.criticalRush} (stale: ${m.staleCriticalRush})`);
    lines.push(`  Completed today: ${m.closedToday}`);
    lines.push("");
  }
  lines.push(`Full dashboard: ${args.dashboardUrl}`);
  return lines.join("\n");
}

function renderHtml(args: {
  metrics: CsrMetrics[];
  todayPacific: string;
  dashboardUrl: string;
}): string {
  const cards = args.metrics.map(renderCard).join("");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F7F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#212124;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr><td style="background:#111111;color:#ffffff;padding:20px 24px;">
            <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#CACACE;">Color Graphics</div>
            <div style="font-size:22px;font-weight:800;letter-spacing:-0.01em;margin-top:2px;">CSR Performance · ${escapeHtml(args.todayPacific)}</div>
          </td></tr>
          <tr><td style="padding:20px 24px;">
            ${cards}
            <p style="margin:24px 0 0;font-size:13px;color:#6E6E76;">
              <a href="${escapeAttr(args.dashboardUrl)}" style="color:#E01B2B;font-weight:600;text-decoration:none;">Open the full dashboard →</a>
            </p>
          </td></tr>
          <tr><td style="background:#F7F7F8;padding:14px 24px;font-size:11px;color:#9C9CA2;text-align:center;">
            Sent by Color Graphics internal tools · automated digest
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderCard(m: CsrMetrics): string {
  const headlineColor =
    m.headlineKpi === 0 ? "#2B8A4A" : m.headlineKpi <= 3 ? "#D4881A" : "#E01B2B";
  const issuesList = ISSUE_KINDS.filter((k) => (m.issueCounts[k] ?? 0) > 0)
    .map(
      (k) =>
        `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:#F7F7F8;color:#363639;font-size:11px;margin:0 4px 4px 0;">${escapeHtml(ISSUE_LABEL[k])} ${m.issueCounts[k]}</span>`,
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E2E2E5;border-radius:12px;margin-bottom:16px;">
      <tr><td style="padding:16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="font-size:18px;font-weight:800;color:#111114;">${escapeHtml(m.csrName)}</td>
            <td align="right">
              <div style="font-size:32px;font-weight:900;color:${headlineColor};line-height:1;">${m.headlineKpi}</div>
              <div style="font-size:10px;letter-spacing:0.04em;text-transform:uppercase;color:#6E6E76;margin-top:2px;">attention score</div>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;">
          ${row("Workload", m.workload, "#212124")}
          ${row("Due today", m.dueToday, m.dueToday > 0 ? "#D4881A" : "#212124")}
          ${row("Overdue", m.overdue, m.overdue > 0 ? "#E01B2B" : "#2B8A4A")}
          ${row("Critical / Rush", m.criticalRush, m.staleCriticalRush > 0 ? "#E01B2B" : "#212124")}
          ${row("Stale crit / rush", m.staleCriticalRush, m.staleCriticalRush > 0 ? "#E01B2B" : "#212124")}
          ${row("Completed today", m.closedToday, m.closedToday > 0 ? "#2B8A4A" : "#212124")}
        </table>
        ${issuesList ? `<div style="margin-top:14px;">${issuesList}</div>` : ""}
      </td></tr>
    </table>`;
}

function row(label: string, value: number | string, color: string): string {
  return `<tr>
    <td style="padding:4px 0;font-size:13px;color:#6E6E76;">${escapeHtml(label)}</td>
    <td align="right" style="padding:4px 0;font-size:14px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;">${escapeHtml(String(value))}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
