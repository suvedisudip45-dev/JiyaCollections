import { createSmtpEmailProvider } from "./smtpEmailProvider.js";
import { createSparrowSmsProvider } from "./sparrowSmsProvider.js";

export const createNotificationProviders = ({ config, fetchImpl, createTransport }) => ({
  sms: createSparrowSmsProvider({ config: config.sms, fetchImpl }),
  email: createSmtpEmailProvider({ config: config.email, createTransport }),
});
