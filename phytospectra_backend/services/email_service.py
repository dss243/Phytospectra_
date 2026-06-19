import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging
from typing import Any, Optional

from core.config import settings

logger = logging.getLogger(__name__)


def lookup_user_email(supabase_client: Any, user_id: Optional[str]) -> Optional[str]:
    """Resolve a Supabase auth user's email (service role required)."""
    if not user_id or not supabase_client:
        return None
    try:
        res = supabase_client.auth.admin.get_user_by_id(user_id)
        user = getattr(res, "user", None)
        email = getattr(user, "email", None) if user else None
        if email and "@" in email:
            return email.strip()
    except Exception as e:
        logger.warning("Email lookup failed for user %s: %s", user_id, e)
    return None


def send_stress_email(
    to_emails: list[str],
    field_id: str,
    health_score: float,
    severity: str,
    message: str,
    lat: float,
    lng: float,
):
    if not settings.GMAIL_SENDER or not settings.GMAIL_APP_PASSWORD:
        logger.warning("Gmail credentials not configured, skipping email")
        return

    severity_color = {
        "high":   "#ef4444",
        "medium": "#f59e0b",
        "low":    "#22c55e",
    }.get(severity, "#f59e0b")

    subject = f"⚠️ [{severity.upper()}] Crop Stress Alert — Field {field_id[:8]}"

    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 16px;">
        <div style="background: {severity_color}; padding: 16px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0;">⚠️ Crop Stress Alert</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
            <p style="font-size: 15px; color: #111827;">{message}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
                <tr style="background: #f9fafb;">
                    <td style="padding: 10px 12px; font-weight: bold; color: #374151; width: 40%;">Field ID</td>
                    <td style="padding: 10px 12px; color: #111827;">{field_id[:8]}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; font-weight: bold; color: #374151;">Health Score</td>
                    <td style="padding: 10px 12px; color: #111827;">{health_score:.0f}%</td>
                </tr>
                <tr style="background: #f9fafb;">
                    <td style="padding: 10px 12px; font-weight: bold; color: #374151;">Severity</td>
                    <td style="padding: 10px 12px;">
                        <span style="background: {severity_color}; color: white; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: bold;">
                            {severity.upper()}
                        </span>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; font-weight: bold; color: #374151;">Location</td>
                    <td style="padding: 10px 12px; color: #111827;">{lat:.5f}°N, {lng:.5f}°E</td>
                </tr>
            </table>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 12px;">
                Sent automatically by PhytoSpectra Alert System
            </p>
        </div>
    </div>
    """

    for recipient in to_emails:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = f"PhytoSpectra Alerts <{settings.GMAIL_SENDER}>"
            msg["To"]      = recipient
            msg.attach(MIMEText(html, "html"))

            with smtplib.SMTP("smtp.gmail.com", 587) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(settings.GMAIL_SENDER, settings.GMAIL_APP_PASSWORD)
                smtp.sendmail(settings.GMAIL_SENDER, recipient, msg.as_string())

            logger.info("Alert email sent to %s", recipient)

        except Exception as e:
            logger.error("Failed to send email to %s: %s", recipient, e)


def notify_stress_alert_emails(
    supabase_client: Any,
    *,
    farmer_id: str,
    agronomist_id: Optional[str],
    field_id: str,
    health_score: float,
    severity: str,
    message: str,
    lat: float,
    lng: float,
) -> list[str]:
    """
    Email the farmer and matched agronomist from GMAIL_SENDER (e.g. phytospectra@gmail.com).
    Returns the list of addresses emailed.
    """
    recipients: list[str] = []
    for uid in (farmer_id, agronomist_id):
        if not uid:
            continue
        email = lookup_user_email(supabase_client, uid)
        if email and email not in recipients:
            recipients.append(email)

    if not recipients:
        logger.warning(
            "Stress alert email skipped — no addresses for farmer=%s agronomist=%s",
            farmer_id,
            agronomist_id,
        )
        return []

    send_stress_email(
        to_emails=recipients,
        field_id=field_id,
        health_score=health_score,
        severity=severity,
        message=message,
        lat=lat,
        lng=lng,
    )
    return recipients