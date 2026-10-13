import type { Adapter } from '../../context';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface SmsMessage {
  to: string;
  body: string;
}
export interface PushMessage {
  userId: string;
  title: string;
  body: string;
  link?: string | null;
}

/** Outbound email, SMS and push. Implementations return the provider's message id. */
export interface MessagingAdapter extends Adapter {
  sendEmail(m: EmailMessage): Promise<{ id: string }>;
  sendSms(m: SmsMessage): Promise<{ id: string }>;
  sendPush(m: PushMessage): Promise<{ id: string }>;
}
