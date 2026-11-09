import { SecureContextOptions } from "tls";
import { SMTPServer, SMTPServerAuthentication, SMTPServerAuthenticationResponse, SMTPServerSession } from "smtp-server";
import { Readable } from "stream";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { authenticateMailClient } from "./mail-client-credentials";
import { MailClientSubmitError, submitMailClientMessage } from "./mail-client-submit";
import { mailClientAccessEnabled } from "./mail-client-auth";
import { smtpSubmissionPort } from "./mail-client-ports";
const debugLog = debug(envConfig.logNamespace("mail-client:smtp"));
debugLog.enabled = true;

function smtpLog(message: string, ...details: unknown[]): void {
  debugLog(message, ...details);
}

export function startMailClientSmtp(options: SecureContextOptions | null = null): SMTPServer {
  const port = smtpSubmissionPort();
  const server = new SMTPServer({
    banner: "NGX committee mail",
    authOptional: false,
    ...options,
    secure: !!options,
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    hideSTARTTLS: true,
    size: 15 * 1024 * 1024,
    onConnect(session, callback) {
      smtpLog("SMTP connect from", session.remoteAddress);
      mailClientAccessEnabled().then(enabled => {
        if (enabled) {
          smtpLog("SMTP accepted", session.remoteAddress);
          callback();
        } else {
          smtpLog("SMTP rejected: mail application access is switched off", session.remoteAddress);
          callback(new Error("Mail application access is switched off"));
        }
      }).catch(error => {
        smtpLog("SMTP connect error", (error as Error).message);
        callback(error as Error);
      });
    },
    onAuth(auth: SMTPServerAuthentication, _session: SMTPServerSession, callback: (error: Error | null, response?: SMTPServerAuthenticationResponse) => void) {
      smtpLog("SMTP AUTH user", auth.username);
      authenticateMailClient(auth.username || "", auth.password || "").then(member => {
        if (member) {
          smtpLog("SMTP AUTH ok", auth.username);
          callback(null, {user: member});
        } else {
          smtpLog("SMTP AUTH failed", auth.username);
          callback(new Error("Invalid username or application password"));
        }
      }).catch(error => {
        smtpLog("SMTP AUTH error", (error as Error).message);
        callback(error as Error);
      });
    },
    onData(stream: Readable, session: SMTPServerSession, callback: (error?: Error | null) => void) {
      const chunks: Buffer[] = [];
      stream.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on("error", error => callback(error));
      stream.on("end", () => {
        const member = session.user as {id?: string} | undefined;
        if (!member?.id) {
          callback(new Error("Not authenticated"));
        } else {
          submitMailClientMessage(member as never, Buffer.concat(chunks as unknown as Uint8Array[]))
            .then(() => callback())
            .catch(error => {
              const submitError = error as MailClientSubmitError;
              smtpLog("submit failed", submitError.message);
              callback(submitError);
            });
        }
      });
    }
  });
  server.listen(port, () => smtpLog(`SMTP submission listening on ${port}`));
  server.on("error", error => smtpLog("SMTP server error", (error as Error).message));
  return server;
}
