import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export async function sendWelcomeEmail(user, temporaryPassword) {
  if (!resend) {
    console.log('⚠️ RESEND_API_KEY não configurada. Email simulado para:', user.email);
    console.log('   Senha temporária:', temporaryPassword);
    return { success: true, simulated: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject: 'Bem-vindo(a) ao Diagnóstico Psicossocial - Cuidar+',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #252F1F; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .header { text-align: center; margin-bottom: 40px; }
            .logo { font-size: 32px; font-weight: bold; color: #00E8C8; }
            .content { background: #FFFCF2; border-radius: 16px; padding: 32px; margin-bottom: 24px; }
            .credentials { background: white; border: 1px solid #E6E9EA; border-radius: 12px; padding: 24px; margin: 24px 0; }
            .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
            .value { font-size: 18px; font-weight: 600; margin-top: 4px; }
            .button { display: inline-block; background: #252F1F; color: white; padding: 14px 32px; border-radius: 50px; text-decoration: none; font-weight: 500; margin-top: 24px; }
            .footer { text-align: center; color: #64748b; font-size: 14px; margin-top: 40px; }
            .highlight { color: #00E8C8; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Cuidar+</div>
              <p class="highlight">Performance com bem-estar</p>
            </div>
            
            <div class="content">
              <h2>Olá, ${user.name}!</h2>
              <p>Você foi convidado(a) a participar do <strong>Diagnóstico Psicossocial</strong> da empresa.</p>
              
              <p>Este questionário faz parte das ações de conformidade com a <strong>NR-1</strong> e tem como objetivo mapear fatores de risco psicossocial no ambiente de trabalho.</p>
              
              <p><strong>Suas respostas são 100% anônimas</strong> e serão utilizadas apenas para análises agregadas, sem identificação individual.</p>
              
              <div class="credentials">
                <div style="margin-bottom: 16px;">
                  <div class="label">Seu e-mail de acesso</div>
                  <div class="value">${user.email}</div>
                </div>
                <div>
                  <div class="label">Sua senha temporária</div>
                  <div class="value">${temporaryPassword}</div>
                </div>
              </div>
              
              <p>O questionário leva aproximadamente <strong>10-15 minutos</strong> para ser respondido.</p>
              
              <center>
                <a href="${APP_URL}" class="button">Acessar o Diagnóstico</a>
              </center>
            </div>
            
            <div class="footer">
              <p>Cuidar+ | Desenvolvimento Humano</p>
              <p>Sustentando o comportamento. Transformando a liderança.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Erro Resend (usando modo simulado):', error.message || error);
      console.log('   Senha temporária para', user.email + ':', temporaryPassword);
      return { success: true, simulated: true };
    }

    console.log('✅ Email enviado para:', user.email);
    return { success: true, data };
  } catch (error) {
    console.error('Erro ao enviar email (usando modo simulado):', error.message || error);
    console.log('   Senha temporária para', user.email + ':', temporaryPassword);
    return { success: true, simulated: true };
  }
}

export async function sendPasswordResetEmail(user, resetToken) {
  if (!resend) {
    console.log('⚠️ RESEND_API_KEY não configurada. Email simulado para:', user.email);
    console.log('   Token de reset:', resetToken);
    return { success: true, simulated: true };
  }

  try {
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject: 'Redefinição de Senha - Cuidar+',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #252F1F; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .header { text-align: center; margin-bottom: 40px; }
            .logo { font-size: 32px; font-weight: bold; color: #00E8C8; }
            .content { background: #FFFCF2; border-radius: 16px; padding: 32px; }
            .button { display: inline-block; background: #252F1F; color: white; padding: 14px 32px; border-radius: 50px; text-decoration: none; font-weight: 500; margin-top: 24px; }
            .footer { text-align: center; color: #64748b; font-size: 14px; margin-top: 40px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Cuidar+</div>
            </div>
            
            <div class="content">
              <h2>Redefinição de Senha</h2>
              <p>Olá, ${user.name}!</p>
              <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha:</p>
              
              <center>
                <a href="${resetUrl}" class="button">Redefinir Senha</a>
              </center>
              
              <p style="margin-top: 24px; font-size: 14px; color: #64748b;">
                Este link expira em 1 hora. Se você não solicitou a redefinição de senha, ignore este email.
              </p>
            </div>
            
            <div class="footer">
              <p>Cuidar+ | Desenvolvimento Humano</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Erro Resend (usando modo simulado):', error.message || error);
      return { success: true, simulated: true };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Erro ao enviar email (usando modo simulado):', error.message || error);
    return { success: true, simulated: true };
  }
}
