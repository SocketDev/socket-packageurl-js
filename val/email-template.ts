/**
 * @fileoverview Login-code email template.
 *
 * Designed for email-client compatibility:
 *   - Inline styles only (Gmail strips <style>, Outlook strips external)
 *   - Table-free layout for modern clients; degrades gracefully in Outlook
 *   - No custom fonts — system font stack
 *   - No `color-mix`, `oklch`, or other CSS4 features
 *   - Logo uses HTTPS image hosted at socket.dev (public CDN)
 *
 * Copy intentionally does NOT say "sign in to socket.dev" because the
 * code grants access to a tour viewer, not socket.dev itself.
 * Disclaimer links to security@socket.dev so unexpected codes surface
 * as real security signal, not noise to ignore.
 */

import { htmlEscape } from './validate.ts'

export const renderLoginEmail = (code: string): string => {
  const safeCode = htmlEscape(code)
  const digits = safeCode
    .split('')
    .map(d => `<span style="display:inline-block;padding:0 8px;">${d}</span>`)
    .join('')
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:540px;margin:40px auto;padding:32px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://socket.dev/images/logo-280x80.png" alt="Socket" width="140" height="40" style="display:inline-block;" />
    </div>
    <h1 style="margin:0 0 8px 0;font-size:24px;font-weight:600;color:#1a1a1a;text-align:center;">Your Socket tour login code</h1>
    <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#57606a;text-align:center;">Enter this code in the tour to sign in. It expires in 10 minutes.</p>
    <div style="margin:28px 0;padding:20px;background:#f5f6f8;border-radius:8px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.06em;color:#1a1a1a;">
      ${digits}
    </div>
    <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#8b949e;text-align:center;">Didn't request this code? Please report it to <a href="mailto:security@socket.dev?subject=Unrequested%20tour%20login%20code" style="color:#0969da;text-decoration:underline;">security@socket.dev</a>.</p>
  </div>
</body>
</html>`
}

export const renderLoginEmailText = (code: string): string =>
  `Your Socket tour login code is ${code}. It expires in 10 minutes.\n\n` +
  `Didn't request this code? Please report it to security@socket.dev.`
