import { brand } from '@waylo/shared';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Branded transactional email (table layout and inline styles for mail clients). Only WAYLO
 * branding appears; no tool or template credits.
 */
export function renderEmail(input: { title: string; body: string; ctaLabel?: string; ctaUrl?: string; sandbox: boolean }) {
  const c = brand.colors;
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4A5568">${esc(p)}</p>`)
    .join('');
  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<a href="${esc(input.ctaUrl)}" style="display:inline-block;margin-top:8px;padding:12px 22px;border-radius:999px;background:${c.cobalt};color:#ffffff;font-weight:600;text-decoration:none">${esc(input.ctaLabel)}</a>`
      : '';
  const sandbox = input.sandbox
    ? `<p style="margin:0 0 16px;padding:8px 12px;border-radius:10px;background:#FDE7E2;color:#0E1A2B;font-size:12px">Sandbox message: no real booking, ride or payment is involved.</p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.title)}</title></head>
<body style="margin:0;background:${c.ivory};font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.ivory};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${c.grey};border-radius:20px;overflow:hidden">
<tr><td style="background:${c.midnight};padding:18px 24px"><span style="color:${c.ivory};font-size:20px;font-weight:800;letter-spacing:-0.5px">${brand.name}</span></td></tr>
<tr><td style="padding:28px 24px">${sandbox}<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:${c.midnight}">${esc(input.title)}</h1>${paragraphs}${cta}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${c.grey};font-size:12px;color:#7A8494">${esc(brand.tagline)}<br>Questions? Reply to this email or write to ${esc(brand.supportEmail)}.<br>You can change notification settings in your ${brand.name} profile.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${input.title}\n\n${input.body}${input.ctaUrl ? `\n\n${input.ctaLabel}: ${input.ctaUrl}` : ''}\n\n— ${brand.name}${input.sandbox ? '\n(Sandbox message: no real booking, ride or payment is involved.)' : ''}`;
  return { html, text };
}
