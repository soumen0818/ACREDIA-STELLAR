import { getSiteUrl } from '@/lib/siteUrl';
import { createUnsubscribeToken } from './notificationUnsubscribe';

export function getBaseTemplate(title: string, preheader: string, content: string, userId: string) {
    const appUrl = getSiteUrl();
    // Signed, expiring, user-scoped token (ACREDIA-STELLAR#235) — a bare
    // userId in the link can no longer mutate anyone's notification settings.
    const unsubscribeToken = createUnsubscribeToken(userId);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #000000; color: #E5E7EB; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .logo { font-size: 24px; font-weight: bold; color: #FFFFFF; text-decoration: none; letter-spacing: -0.5px; }
        .logo span { color: #3B82F6; }
        .content { background-color: #111827; border: 1px solid #1F2937; border-radius: 12px; padding: 40px; }
        .title { color: #FFFFFF; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 24px; }
        .text { font-size: 16px; line-height: 24px; color: #9CA3AF; margin-bottom: 24px; }
        .button { display: inline-block; background-color: #FFFFFF; color: #000000; text-decoration: none; font-weight: 500; padding: 12px 24px; border-radius: 6px; font-size: 14px; }
        .footer { margin-top: 40px; text-align: center; font-size: 14px; color: #6B7280; }
        .footer a { color: #9CA3AF; text-decoration: underline; }
        .preheader { display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: transparent; opacity: 0; }
    </style>
</head>
<body>
    <span class="preheader">${preheader}</span>
    <div class="container">
        <div class="header">
            <a href="${appUrl}" class="logo">Acredia<span>.</span></a>
        </div>
        <div class="content">
            <h1 class="title">${title}</h1>
            ${content}
        </div>
        <div class="footer">
            <p>You received this email because you are a registered user on Acredia.</p>
            <p>Don't want to receive these emails? <a href="${appUrl}/api/account/notifications/unsubscribe?userId=${userId}&token=${unsubscribeToken}">Manage your notification preferences</a>.</p>
        </div>
    </div>
</body>
</html>
    `;
}

export function buildCredentialIssuedEmail(studentName: string, institutionName: string, credentialUrl: string, userId: string) {
    const content = `
        <p class="text">Hi ${studentName},</p>
        <p class="text"><strong>${institutionName}</strong> has just issued a new verifiable credential to your wallet on Acredia.</p>
        <p class="text">You can view your new credential, verify its on-chain authenticity, and share it with employers directly from your dashboard.</p>
        <a href="${credentialUrl}" class="button">View Credential</a>
    `;
    return getBaseTemplate('New Credential Issued', `You've received a new credential from ${institutionName}.`, content, userId);
}

export function buildCredentialRevokedEmail(studentName: string, institutionName: string, userId: string) {
    const content = `
        <p class="text">Hi ${studentName},</p>
        <p class="text">We're writing to let you know that <strong>${institutionName}</strong> has revoked a credential that was previously issued to you.</p>
        <p class="text">This credential will now show as "Revoked" when verified by third parties. If you believe this is an error, please contact the issuing institution directly.</p>
    `;
    return getBaseTemplate('Credential Revoked', `A credential from ${institutionName} has been revoked.`, content, userId);
}

export function buildInstitutionVerifiedEmail(institutionName: string, userId: string) {
    const appUrl = getSiteUrl();
    const content = `
        <p class="text">Hi there,</p>
        <p class="text">Great news! <strong>${institutionName}</strong> has been successfully verified by the Acredia administrators.</p>
        <p class="text">Your account is now fully active. You can link your institution's Stellar wallet and begin issuing verifiable credentials to your students.</p>
        <a href="${appUrl}/dashboard/issue" class="button">Go to Dashboard</a>
    `;
    return getBaseTemplate('Institution Verified', 'Your institution has been approved.', content, userId);
}
