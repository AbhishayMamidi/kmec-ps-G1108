"""Email notification service for NeuroSentinel AI.

Sends EEG report completion notifications with the clinical PDF attached.
Supports Resend API (preferred), Vercel relay, or SMTP fallback.
"""
from __future__ import annotations

import base64
import logging
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_APP_URL = "https://neuro-sentinel-ai-6vfv.vercel.app"
LOGO_URL = f"{DEFAULT_APP_URL}/logo.jpeg"

_SUBJECT_SEIZURE = "NeuroSentinel AI - Seizure Activity Detected in {filename}"
_SUBJECT_SUSPICIOUS = "NeuroSentinel AI - Suspicious Patterns Found in {filename}"
_SUBJECT_NO_SEIZURE = "NeuroSentinel AI - No Seizure Activity Detected in {filename}"
_SUBJECT_TIMEOUT = "NeuroSentinel AI - EEG Analysis Timed Out for {filename}"
_SUBJECT_FAILED = "NeuroSentinel AI - EEG Analysis Failed for {filename}"
_SUBJECT_ABORTED = "NeuroSentinel AI - EEG Analysis Aborted for {filename}"
_SUBJECT_SIZE = "NeuroSentinel AI - File Size Warning for {filename}"


def _normalize_app_url(app_url: str | None) -> str:
    return DEFAULT_APP_URL


# ─────────────────────────────────────────────────────────────────────────────
# Email design system — clinical, clean, email-safe (table-based layout)
# Tested against Gmail, Outlook, Apple Mail, Yahoo Mail
# ─────────────────────────────────────────────────────────────────────────────

_EC_BG         = "#F0F4F8"   # email outer background
_EC_CARD       = "#FFFFFF"   # card surface
_EC_HEADER     = "#0F172A"   # dark navy header / footer
_EC_ACCENT     = "#10B981"   # NeuroSentinel teal
_EC_TEXT       = "#1E293B"   # primary text
_EC_TEXT_SEC   = "#475569"   # secondary text
_EC_TEXT_MUTED = "#94A3B8"   # muted / caption text
_EC_BORDER     = "#E2E8F0"   # divider / border


def _status_badge(status_key: str) -> str:
    configs: dict[str, tuple[str, str, str, str]] = {
        "seizure":    ("#EF4444", "#FEF2F2", "#FECACA", "&#9888;&#xFE0E;&nbsp; Seizure Activity Detected"),
        "suspicious": ("#F59E0B", "#FFFBEB", "#FDE68A", "&#9888;&#xFE0E;&nbsp; Suspicious Patterns Found"),
        "clear":      ("#10B981", "#ECFDF5", "#6EE7B7", "&#10003;&nbsp; Analysis Complete"),
        "failed":     ("#EF4444", "#FEF2F2", "#FECACA", "&#10007;&nbsp; Analysis Failed"),
        "timeout":    ("#F59E0B", "#FFFBEB", "#FDE68A", "&#8987;&nbsp; Analysis Timed Out"),
        "aborted":    ("#64748B", "#F8FAFC", "#CBD5E1", "&mdash;&nbsp; Analysis Aborted"),
        "size":       ("#F59E0B", "#FFFBEB", "#FDE68A", "&#8679;&nbsp; File Size Limit Exceeded"),
    }
    color, bg, border, label = configs.get(status_key, configs["clear"])
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;"><tr><td align="center">'
        f'<span style="display:inline-block;padding:10px 28px;border-radius:100px;'
        f'background-color:{bg};border:1.5px solid {border};color:{color};font-size:13px;'
        f'font-weight:700;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;'
        f'letter-spacing:0.03em;">{label}</span></td></tr></table>'
    )


def _email_open(subtitle: str, status_key: str) -> str:
    """Returns the full HTML open: DOCTYPE → hero header → content area open → status badge."""
    badge = _status_badge(status_key)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>NeuroSentinel AI</title>
</head>
<body style="margin:0;padding:0;background-color:{_EC_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{_EC_BG};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <!--[if (gte mso 9)|(IE)]><table width="700" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             style="max-width:700px;width:100%;background-color:{_EC_CARD};border-radius:16px;overflow:hidden;">

        <!-- ═══ HERO HEADER ═══ -->
        <tr>
          <td style="background-color:{_EC_HEADER};padding:44px 48px 36px;text-align:center;">
            <img src="{LOGO_URL}" alt="NeuroSentinel AI" width="72" height="72"
                 style="border-radius:14px;display:block;margin:0 auto 20px;border:0;" />
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#FFFFFF;
                        letter-spacing:0.08em;text-transform:uppercase;
                        font-family:'Segoe UI',Arial,Helvetica,sans-serif;">NeuroSentinel AI</h1>
            <p style="margin:0 0 16px;font-size:10px;color:{_EC_TEXT_MUTED};
                       letter-spacing:0.16em;text-transform:uppercase;
                       font-family:'Segoe UI',Arial,Helvetica,sans-serif;">Clinical EEG Intelligence Platform</p>
            <p style="margin:0;font-size:14px;color:#CBD5E1;line-height:1.6;
                       font-family:'Segoe UI',Arial,Helvetica,sans-serif;">{subtitle}</p>
          </td>
        </tr>

        <!-- Teal accent bar -->
        <tr>
          <td style="background-color:{_EC_ACCENT};height:4px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>
        </tr>

        <!-- ═══ CONTENT AREA ═══ -->
        <tr>
          <td style="padding:36px 48px 28px;">
            {badge}"""


def _email_close(
    app_url: str,
    cta_label: str,
    cta_color: str,
    has_pdf: bool,
    disclaimer: str,
) -> str:
    """Returns PDF callout (optional) → CTA button → disclaimer card → footer → HTML close."""
    pdf_section = ""
    if has_pdf:
        pdf_section = f"""
            <!-- PDF attachment callout -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
              <tr>
                <td style="background-color:#F8FAFC;border:1px solid {_EC_BORDER};border-radius:10px;padding:16px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="28" style="vertical-align:middle;font-size:22px;color:{_EC_ACCENT};">&#128196;</td>
                      <td style="padding-left:14px;vertical-align:middle;">
                        <p style="margin:0 0 3px;font-size:11px;font-weight:700;color:{_EC_TEXT};
                                   text-transform:uppercase;letter-spacing:0.07em;
                                   font-family:'Segoe UI',Arial,Helvetica,sans-serif;">Attached Documents</p>
                        <p style="margin:0;font-size:13px;color:{_EC_TEXT_SEC};
                                   font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
                          <span style="color:{_EC_ACCENT};font-weight:700;">&#10003;</span>&nbsp;
                          Clinical EEG Report (PDF) &mdash; available for download directly from this email
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>"""

    return f"""
            {pdf_section}

            <!-- CTA button -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 8px;">
              <tr>
                <td align="center" style="border-radius:10px;background-color:{cta_color};">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                    href="{app_url}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="19%" stroke="f" fillcolor="{cta_color}">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;">{cta_label}</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="{app_url}" target="_blank"
                     style="display:inline-block;background-color:{cta_color};color:#FFFFFF;
                            font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;
                            font-weight:700;text-decoration:none;padding:16px 40px;
                            border-radius:10px;letter-spacing:0.02em;min-width:200px;text-align:center;">
                    {cta_label}
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- ═══ MEDICAL DISCLAIMER ═══ -->
        <tr>
          <td style="background-color:#F8FAFC;border-top:1px solid {_EC_BORDER};padding:20px 48px;">
            <p style="margin:0;font-size:11px;color:{_EC_TEXT_MUTED};text-align:center;
                       line-height:1.8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">{disclaimer}</p>
          </td>
        </tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="background-color:{_EC_HEADER};padding:24px 48px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#FFFFFF;
                       font-family:'Segoe UI',Arial,Helvetica,sans-serif;">NeuroSentinel AI</p>
            <p style="margin:0 0 14px;font-size:10px;color:{_EC_TEXT_MUTED};
                       letter-spacing:0.12em;text-transform:uppercase;
                       font-family:'Segoe UI',Arial,Helvetica,sans-serif;">Clinical EEG Intelligence Platform</p>
            <p style="margin:0;font-size:11px;color:#475569;
                       font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              Generated automatically by NeuroSentinel AI &nbsp;&middot;&nbsp;
              <a href="{app_url}" style="color:{_EC_ACCENT};text-decoration:none;">Open Application</a>
            </p>
          </td>
        </tr>

      </table>
      <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>"""


def _metrics_row(items: list[tuple[str, str, str]]) -> str:
    """Render a row of metric cells: [(label, value, value_color), ...]."""
    total = len(items)
    cells = ""
    for i, (label, value, val_color) in enumerate(items):
        border_right = f"border-right:1px solid {_EC_BORDER};" if i < total - 1 else ""
        cells += (
            f'<td style="text-align:center;padding:18px 12px;{border_right}">'
            f'<p style="margin:0 0 4px;font-size:10px;font-weight:700;color:{_EC_TEXT_MUTED};'
            f'letter-spacing:0.1em;text-transform:uppercase;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">{label}</p>'
            f'<p style="margin:0;font-size:18px;font-weight:800;color:{val_color};'
            f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">{value}</p>'
            f'</td>'
        )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;border:1px solid {_EC_BORDER};border-radius:10px;overflow:hidden;">'
        f'<tr>{cells}</tr></table>'
    )


def _summary_table(rows: list[tuple[str, str, str]]) -> str:
    """Render a labelled summary table: [(label, value, value_color), ...]."""
    html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;border:1px solid {_EC_BORDER};border-radius:10px;overflow:hidden;border-collapse:separate;">'
    )
    for i, (label, value, val_color) in enumerate(rows):
        bg = "#F8FAFC" if i % 2 == 0 else _EC_CARD
        html += (
            f'<tr style="background-color:{bg};">'
            f'<td style="padding:12px 20px;font-size:11px;font-weight:700;color:{_EC_TEXT_MUTED};'
            f'text-transform:uppercase;letter-spacing:0.07em;width:38%;'
            f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">{label}</td>'
            f'<td style="padding:12px 20px;font-size:14px;font-weight:600;color:{val_color};'
            f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">{value}</td>'
            f'</tr>'
        )
    html += '</table>'
    return html


# ─────────────────────────────────────────────────────────────────────────────
# Email builders — HTML logic only. Delivery logic is unchanged below.
# ─────────────────────────────────────────────────────────────────────────────

def _build_patient_email(report: dict[str, Any], filename: str, app_url: str) -> str:
    result = report.get("result_label", "Unknown")
    risk = report.get("risk_level", "Unknown")
    event_count = report.get("event_count", 0) or 0
    confidence = report.get("confidence_score")
    confidence_text = f"{confidence:.1f}%" if isinstance(confidence, (int, float)) else "unknown"
    diagnostic_state = report.get("diagnostic_state", "")
    seizure_detected = diagnostic_state == "DETECTED" or result.lower() == "seizure detected" or (isinstance(event_count, int) and event_count > 0)
    is_suspicious = diagnostic_state == "SUSPICIOUS"

    if seizure_detected:
        status_key = "seizure"
        subtitle = "Your EEG analysis report is ready for review"
        opening = (
            f'Your EEG recording <strong style="color:{_EC_TEXT};">{filename}</strong> has been analysed by NeuroSentinel AI. '
            f"The analysis has detected seizure-like activity &mdash; {event_count} segment(s) were flagged "
            f"with an overall risk level of <strong>{risk}</strong> and model confidence of <strong>{confidence_text}</strong>."
        )
        action = (
            "We recommend sharing this report with your healthcare provider or neurologist as soon as possible. "
            "Please do not make any changes to your medication or treatment without consulting your doctor first."
        )
        cta_color = "#EF4444"
    elif is_suspicious:
        status_key = "suspicious"
        subtitle = "Your EEG analysis report is ready for review"
        opening = (
            f'Your EEG recording <strong style="color:{_EC_TEXT};">{filename}</strong> has been analysed by NeuroSentinel AI. '
            f"The analysis found suspicious patterns that warrant attention &mdash; the model flagged candidate "
            f"seizure-like activity, but these did not meet the criteria for confirmed seizure events. "
            f"The overall risk level is <strong>{risk}</strong> with model confidence of <strong>{confidence_text}</strong>."
        )
        action = (
            "We recommend sharing this report with your neurologist so they can evaluate whether further "
            "testing, such as a repeat or extended EEG, is appropriate. There is no need for emergency action."
        )
        cta_color = "#F59E0B"
    else:
        status_key = "clear"
        subtitle = "Your EEG analysis report is ready for review"
        opening = (
            f'Your EEG recording <strong style="color:{_EC_TEXT};">{filename}</strong> has been analysed by NeuroSentinel AI. '
            f"No seizure activity was detected in this recording. "
            f"The overall risk level is <strong>{risk}</strong> with model confidence of <strong>{confidence_text}</strong>."
        )
        action = (
            "This is a reassuring result. We still recommend sharing this report with your doctor "
            "at your next scheduled visit for their review."
        )
        cta_color = _EC_ACCENT

    content = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:24px;">'
        f'<tr><td style="background-color:#F8FAFC;border:1px solid {_EC_BORDER};border-radius:10px;padding:24px 28px;">'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:{_EC_TEXT};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">{opening}</p>'
        f'<p style="margin:0;font-size:15px;line-height:1.75;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">{action}</p>'
        f'</td></tr></table>'
        + _metrics_row([
            ("Risk Level", risk, _EC_TEXT),
            ("Confidence", confidence_text, _EC_ACCENT),
            ("Events Detected", str(event_count), _EC_TEXT),
        ])
        + f'<p style="margin:0 0 28px;font-size:13px;line-height:1.7;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'For a detailed AI-powered summary with health tips, dietary recommendations, and personalised guidance, '
        f'open your report in NeuroSentinel AI.</p>'
    )

    disclaimer = (
        "This report is generated by an AI model and is intended for clinical decision support only. "
        "It does not constitute a medical diagnosis. Always consult your healthcare provider before making any medical decisions."
    )
    return (
        _email_open(subtitle, status_key)
        + content
        + _email_close(app_url, "View Report in NeuroSentinel AI", cta_color, True, disclaimer)
    )


def _build_clinician_email(report: dict[str, Any], filename: str, app_url: str) -> str:
    result = report.get("result_label", "Unknown")
    risk = report.get("risk_level", "Unknown")
    event_count = report.get("event_count", 0) or 0
    confidence = report.get("confidence_score")
    confidence_text = f"{confidence:.1f}%" if isinstance(confidence, (int, float)) else "N/A"
    quality = report.get("quality_grade", "Unknown")
    seizure_in_result = "seizure" in result.lower()
    result_color = "#EF4444" if seizure_in_result else _EC_ACCENT

    content = (
        _summary_table([
            ("File", filename, _EC_TEXT),
            ("Result", result, result_color),
            ("Risk Level", risk, _EC_TEXT),
            ("Events Flagged", str(event_count), _EC_TEXT),
            ("Confidence", confidence_text, _EC_ACCENT),
            ("Signal Quality", quality, _EC_TEXT),
        ])
        + f'<p style="margin:0 0 28px;font-size:13px;line-height:1.7;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'Clinical PDF is attached. For full structured analysis with explainability outputs, '
        f'probability timelines, and SCOUT AI summary, access the report in the application.</p>'
    )

    disclaimer = (
        "AI-generated report for clinical decision support. Not a standalone diagnosis. "
        "All [HEURISTIC] labels are rule-based estimates."
    )
    status_key = "seizure" if seizure_in_result else "clear"
    return (
        _email_open("Clinical EEG Analysis Complete", status_key)
        + content
        + _email_close(app_url, "Open in NeuroSentinel AI", _EC_ACCENT, True, disclaimer)
    )


def _build_researcher_email(report: dict[str, Any], filename: str, app_url: str) -> str:
    result = report.get("result_label", "Unknown")
    risk = report.get("risk_level", "Unknown")
    event_count = report.get("event_count", 0) or 0
    confidence = report.get("confidence_score")
    confidence_text = f"{confidence:.1f}%" if isinstance(confidence, (int, float)) else "N/A"

    content = (
        _metrics_row([
            ("Result", result, _EC_TEXT),
            ("Risk", risk, _EC_TEXT),
            ("Confidence", confidence_text, _EC_ACCENT),
            ("Events", str(event_count), _EC_TEXT),
        ])
        + f'<p style="margin:0 0 28px;font-size:13px;line-height:1.7;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'For the full technical breakdown &mdash; including probability timelines, channel importance '
        f'rankings, attention heatmaps, band power analysis, and SCOUT AI methodology notes &mdash; '
        f'open the report in the application.</p>'
    )

    disclaimer = (
        "Model outputs are decision-support evidence. "
        "Cross-validate flagged segments against raw traces before drawing conclusions."
    )
    return (
        _email_open(f"Analysis of {filename} is complete", "clear")
        + content
        + _email_close(app_url, "Open in NeuroSentinel AI", _EC_ACCENT, True, disclaimer)
    )


def _build_timeout_email(filename: str, app_url: str) -> str:
    content = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;">'
        f'<tr><td style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:24px 28px;">'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:{_EC_TEXT};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'The analysis of your EEG recording <strong>{filename}</strong> has timed out after 1 hour of processing.'
        f'</p>'
        f'<p style="margin:0;font-size:15px;line-height:1.75;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'This typically happens with exceptionally long or complex recordings that exceed our current automated '
        f'processing limits. We recommend splitting the recording into smaller segments and re-uploading them, '
        f'or contacting our technical support team for assistance.'
        f'</p>'
        f'</td></tr></table>'
    )
    disclaimer = "Automated notification from NeuroSentinel AI Clinical Intelligence System."
    return (
        _email_open("EEG Analysis — Processing Halted", "timeout")
        + content
        + _email_close(app_url, "Return to App", "#F59E0B", False, disclaimer)
    )


def _build_failure_email(filename: str, app_url: str, error_msg: str | None = None) -> str:
    error_detail = (
        f'<p style="margin:12px 0 0;font-size:12px;color:#EF4444;'
        f'font-family:monospace;background-color:#FEF2F2;padding:10px 14px;border-radius:6px;">'
        f'Error: {error_msg}</p>'
        if error_msg else ""
    )
    content = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;">'
        f'<tr><td style="background-color:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:24px 28px;">'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:{_EC_TEXT};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'We encountered an unexpected error while processing your EEG recording <strong>{filename}</strong>.'
        f'</p>'
        f'<p style="margin:0;font-size:15px;line-height:1.75;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'This could be due to a corrupt file format, signal interference, or a temporary server issue. '
        f'Please try re-uploading the file.'
        f'</p>'
        f'{error_detail}'
        f'</td></tr></table>'
    )
    disclaimer = "Automated notification from NeuroSentinel AI Clinical Intelligence System."
    return (
        _email_open("EEG Analysis — Processing Error", "failed")
        + content
        + _email_close(app_url, "Return to App", "#EF4444", False, disclaimer)
    )


def _build_aborted_email(filename: str, app_url: str) -> str:
    content = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;">'
        f'<tr><td style="background-color:#F8FAFC;border:1px solid {_EC_BORDER};border-radius:10px;padding:24px 28px;">'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:{_EC_TEXT};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'The analysis for <strong>{filename}</strong> was manually aborted by a user.'
        f'</p>'
        f'<p style="margin:0;font-size:15px;line-height:1.75;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'No report was generated for this file. You can start a new analysis at any time by uploading '
        f'a new EDF file to the dashboard.'
        f'</p>'
        f'</td></tr></table>'
    )
    disclaimer = "Automated notification from NeuroSentinel AI Clinical Intelligence System."
    return (
        _email_open("EEG Analysis — Aborted", "aborted")
        + content
        + _email_close(app_url, "Back to Dashboard", _EC_ACCENT, False, disclaimer)
    )


def _build_size_email(filename: str, app_url: str, limit_mb: int) -> str:
    content = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="margin-bottom:28px;">'
        f'<tr><td style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:24px 28px;">'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:{_EC_TEXT};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'Your EEG recording <strong>{filename}</strong> exceeded our maximum upload size limit of <strong>{limit_mb} MB</strong>.'
        f'</p>'
        f'<p style="margin:0;font-size:15px;line-height:1.75;color:{_EC_TEXT_SEC};'
        f'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">'
        f'To process this recording, please split the EDF file into smaller segments or use a lower sampling rate, '
        f'then re-upload.'
        f'</p>'
        f'</td></tr></table>'
    )
    disclaimer = "Automated notification from NeuroSentinel AI Clinical Intelligence System."
    return (
        _email_open("File Size Limit Exceeded", "size")
        + content
        + _email_close(app_url, "Return to App", "#F59E0B", False, disclaimer)
    )


def _build_email_html(report: dict[str, Any], filename: str, role: str | None, app_url: str) -> str:
    role_lower = (role or "").lower()
    if role_lower == "patient":
      return _build_patient_email(report, filename, app_url)
    if role_lower == "researcher":
      return _build_researcher_email(report, filename, app_url)
    return _build_clinician_email(report, filename, app_url)


def _get_subject(report: dict[str, Any], filename: str) -> str:
    result = report.get("result_label", "")
    event_count = report.get("event_count", 0) or 0
    diagnostic_state = report.get("diagnostic_state", "")
    if diagnostic_state == "DETECTED" or result.lower() == "seizure detected" or (isinstance(event_count, int) and event_count > 0):
        return _SUBJECT_SEIZURE.format(filename=filename)
    if diagnostic_state == "SUSPICIOUS":
        return _SUBJECT_SUSPICIOUS.format(filename=filename)
    return _SUBJECT_NO_SEIZURE.format(filename=filename)


def send_report_email_relay(
    *,
    api_url: str,
    secret: str,
    to_email: str,
    report: dict[str, Any],
    filename: str,
    role: str | None,
    app_url: str = DEFAULT_APP_URL,
    pdf_bytes: bytes | None = None,
) -> tuple[bool, str | None]:
    """Send report notification via Vercel proxy relay (HTTP)."""
    subject = _get_subject(report, filename)
    html = _build_email_html(report, filename, role, _normalize_app_url(app_url))

    payload: dict[str, Any] = {
        "to_email": to_email,
        "subject": subject,
        "html": html,
        "filename": f"NeuroSentinel_Report_{filename.replace('.edf', '')}.pdf",
    }

    if pdf_bytes:
        payload["pdf_base64"] = base64.b64encode(pdf_bytes).decode("ascii")

    try:
        response = httpx.post(
            api_url,
            headers={
                "x-internal-secret": secret,
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=40.0,
        )
        if response.status_code == 200:
            logger.info("Report email sent to %s via Vercel Relay for file %s", to_email, filename)
            return True, None

        err = f"Vercel Relay returned {response.status_code}: {response.text[:200]}"
        logger.warning(err)
        return False, err
    except Exception as exc:
        err = f"Failed to send email via Vercel Relay: {exc}"
        logger.warning(err)
        return False, err


def send_report_email_resend(
    *,
    api_key: str,
    to_email: str,
    from_email: str,
    report: dict[str, Any],
    filename: str,
    role: str | None,
    app_url: str = DEFAULT_APP_URL,
    pdf_bytes: bytes | None = None,
) -> tuple[bool, str | None]:
    """Send report notification via Resend HTTP API."""
    subject = _get_subject(report, filename)
    html = _build_email_html(report, filename, role, _normalize_app_url(app_url))

    payload: dict[str, Any] = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html,
    }

    if pdf_bytes:
        payload["attachments"] = [
            {
                "filename": f"NeuroSentinel_Report_{filename.replace('.edf', '')}.pdf",
                "content": base64.b64encode(pdf_bytes).decode("ascii"),
                "type": "application/pdf",
            }
        ]

    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30.0,
        )
        if response.status_code in (200, 201):
            logger.info("Report email sent to %s via Resend for file %s", to_email, filename)
            return True, None
        err = f"Resend API returned {response.status_code}: {response.text[:200]}"
        logger.warning(err)
        return False, err
    except Exception as exc:
        err = f"Failed to send email via Resend: {exc}"
        logger.warning(err)
        return False, err


def send_report_email_smtp(
    *,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    from_email: str,
    to_email: str,
    report: dict[str, Any],
    filename: str,
    role: str | None,
    app_url: str = DEFAULT_APP_URL,
    pdf_bytes: bytes | None = None,
) -> tuple[bool, str | None]:
    """Send report notification via SMTP."""
    subject = _get_subject(report, filename)
    html = _build_email_html(report, filename, role, _normalize_app_url(app_url))

    msg = MIMEMultipart("mixed")
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(html, "html", "utf-8"))

    if pdf_bytes:
        pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_part.add_header(
            "Content-Disposition",
            "attachment",
            filename=f"NeuroSentinel_Report_{filename.replace('.edf', '')}.pdf",
        )
        msg.attach(pdf_part)

    clean_password = smtp_password.replace(" ", "") if smtp_password else ""

    try:
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
            server.ehlo()
            server.starttls()
            server.ehlo()

        server.login(smtp_user, clean_password)
        server.send_message(msg)
        server.quit()
        logger.info("Report email sent to %s via SMTP (%s) for file %s", to_email, smtp_host, filename)
        return True, None
    except smtplib.SMTPAuthenticationError as exc:
        err = f"SMTP authentication failed for {smtp_host} (likely wrong credentials): {exc}"
        logger.error(err)
        return False, err
    except Exception as exc:
        err = f"Failed to send email via SMTP ({smtp_host}): {exc}"
        logger.warning(err)
        return False, err


def send_report_notification(
    *,
    to_email: str,
    report: dict[str, Any],
    filename: str,
    role: str | None,
    pdf_bytes: bytes | None = None,
    resend_api_key: str | None = None,
    resend_from_email: str = "NeuroSentinel AI <noreply@neurosentinel.app>",
    relay_api_url: str | None = None,
    internal_api_secret: str = "neurosentinel-internal-key-2026",
    smtp_host: str | None = None,
    smtp_port: int = 587,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    smtp_from_email: str | None = None,
    app_url: str = DEFAULT_APP_URL,
) -> tuple[bool, str | None]:
    """Send report completion notification. Tries Resend first, then relay, then SMTP."""
    if not to_email:
        err = "No email address provided - skipping report notification."
        logger.warning(err)
        return False, err

    normalized_app_url = _normalize_app_url(app_url)

    if resend_api_key:
        return send_report_email_resend(
            api_key=resend_api_key,
            to_email=to_email,
            from_email=resend_from_email,
            report=report,
            filename=filename,
            role=role,
            app_url=normalized_app_url,
            pdf_bytes=pdf_bytes,
        )

    if relay_api_url:
        return send_report_email_relay(
            api_url=relay_api_url,
            secret=internal_api_secret,
            to_email=to_email,
            report=report,
            filename=filename,
            role=role,
            app_url=normalized_app_url,
            pdf_bytes=pdf_bytes,
        )

    if smtp_host and smtp_user and smtp_password:
        return send_report_email_smtp(
            smtp_host=smtp_host,
            smtp_port=smtp_port,
            smtp_user=smtp_user,
            smtp_password=smtp_password,
            from_email=smtp_from_email or smtp_user,
            to_email=to_email,
            report=report,
            filename=filename,
            role=role,
            app_url=normalized_app_url,
            pdf_bytes=pdf_bytes,
        )

    logger.info("No email provider configured (RESEND_API_KEY, RELAY_API_URL, or SMTP_*). Skipping email notification for %s.", filename)
    return False, "No email provider configured."


def send_timeout_notification(
    *,
    to_email: str,
    filename: str,
    app_url: str = DEFAULT_APP_URL,
    resend_api_key: str | None = None,
    resend_from_email: str = "NeuroSentinel AI <noreply@neurosentinel.app>",
    smtp_host: str | None = None,
    smtp_port: int = 587,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    smtp_from_email: str | None = None,
    relay_api_url: str | None = None,
    internal_api_secret: str = "neurosentinel-internal-key-2026",
) -> bool:
    if not to_email:
        return False

    subject = _SUBJECT_TIMEOUT.format(filename=filename)
    html = _build_timeout_email(filename, _normalize_app_url(app_url))
    return _send_generic_notification(
        to_email=to_email,
        subject=subject,
        html=html,
        resend_api_key=resend_api_key,
        resend_from_email=resend_from_email,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        smtp_from_email=smtp_from_email,
        relay_api_url=relay_api_url,
        internal_api_secret=internal_api_secret,
    )


def send_failure_notification(
    *,
    to_email: str,
    filename: str,
    error_msg: str | None = None,
    app_url: str = DEFAULT_APP_URL,
    resend_api_key: str | None = None,
    resend_from_email: str = "NeuroSentinel AI <noreply@neurosentinel.app>",
    smtp_host: str | None = None,
    smtp_port: int = 587,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    smtp_from_email: str | None = None,
    relay_api_url: str | None = None,
    internal_api_secret: str = "neurosentinel-internal-key-2026",
) -> bool:
    if not to_email:
        return False

    subject = _SUBJECT_FAILED.format(filename=filename)
    html = _build_failure_email(filename, _normalize_app_url(app_url), error_msg)
    return _send_generic_notification(
        to_email=to_email,
        subject=subject,
        html=html,
        resend_api_key=resend_api_key,
        resend_from_email=resend_from_email,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        smtp_from_email=smtp_from_email,
        relay_api_url=relay_api_url,
        internal_api_secret=internal_api_secret,
    )


def send_aborted_notification(
    *,
    to_email: str,
    filename: str,
    app_url: str = DEFAULT_APP_URL,
    resend_api_key: str | None = None,
    resend_from_email: str = "NeuroSentinel AI <noreply@neurosentinel.app>",
    smtp_host: str | None = None,
    smtp_port: int = 587,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    smtp_from_email: str | None = None,
    relay_api_url: str | None = None,
    internal_api_secret: str = "neurosentinel-internal-key-2026",
) -> bool:
    if not to_email:
        return False

    subject = _SUBJECT_ABORTED.format(filename=filename)
    html = _build_aborted_email(filename, _normalize_app_url(app_url))
    return _send_generic_notification(
        to_email=to_email,
        subject=subject,
        html=html,
        resend_api_key=resend_api_key,
        resend_from_email=resend_from_email,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        smtp_from_email=smtp_from_email,
        relay_api_url=relay_api_url,
        internal_api_secret=internal_api_secret,
    )


def send_size_exceeded_notification(
    *,
    to_email: str,
    filename: str,
    limit_mb: int,
    app_url: str = DEFAULT_APP_URL,
    resend_api_key: str | None = None,
    resend_from_email: str = "NeuroSentinel AI <noreply@neurosentinel.app>",
    smtp_host: str | None = None,
    smtp_port: int = 587,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    smtp_from_email: str | None = None,
    relay_api_url: str | None = None,
    internal_api_secret: str = "neurosentinel-internal-key-2026",
) -> bool:
    if not to_email:
        return False

    subject = _SUBJECT_SIZE.format(filename=filename)
    html = _build_size_email(filename, _normalize_app_url(app_url), limit_mb)
    return _send_generic_notification(
        to_email=to_email,
        subject=subject,
        html=html,
        resend_api_key=resend_api_key,
        resend_from_email=resend_from_email,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        smtp_from_email=smtp_from_email,
        relay_api_url=relay_api_url,
        internal_api_secret=internal_api_secret,
    )


def _send_generic_notification(
    *,
    to_email: str,
    subject: str,
    html: str,
    resend_api_key: str | None,
    resend_from_email: str,
    smtp_host: str | None,
    smtp_port: int,
    smtp_user: str | None,
    smtp_password: str | None,
    smtp_from_email: str | None,
    relay_api_url: str | None = None,
    internal_api_secret: str = "neurosentinel-internal-key-2026",
) -> bool:
    if resend_api_key:
        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": resend_from_email,
                    "to": [to_email],
                    "subject": subject,
                    "html": html,
                },
                timeout=30.0,
            )
            if response.status_code in (200, 201):
                return True
        except Exception:
            pass

    if relay_api_url:
        payload = {
            "to_email": to_email,
            "subject": subject,
            "html": html,
        }
        try:
            response = httpx.post(
                relay_api_url,
                headers={
                    "x-internal-secret": internal_api_secret,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=40.0,
            )
            if response.status_code == 200:
                return True
        except Exception as exc:
            logger.warning(f"Failed to send email via Vercel Relay: {exc}")
            pass

    if smtp_host and smtp_user and smtp_password:
        try:
            msg = MIMEMultipart("mixed")
            msg["From"] = smtp_from_email or smtp_user
            msg["To"] = to_email
            msg["Subject"] = subject
            msg.attach(MIMEText(html, "html", "utf-8"))

            if smtp_port == 465:
                server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30)
            else:
                server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
                server.ehlo()
                server.starttls()
                server.ehlo()

            clean_password = smtp_password.replace(" ", "")
            server.login(smtp_user, clean_password)
            server.send_message(msg)
            server.quit()
            return True
        except Exception:
            pass

    return False
