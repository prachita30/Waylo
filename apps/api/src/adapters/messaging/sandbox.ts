import { randomUUID } from 'node:crypto';
import type { AdapterInfo } from '../../context';
import type { EmailMessage, MessagingAdapter, PushMessage, SmsMessage } from './types';

export type SandboxMessage = { channel: 'email'; at: string; message: EmailMessage } | { channel: 'sms'; at: string; message: SmsMessage } | { channel: 'push'; at: string; message: PushMessage };

/**
 * Sandbox messaging: nothing leaves the machine. Messages are kept in a bounded in-memory outbox
 * that administrators can inspect, so templates and triggers can be tested end to end.
 */
export class SandboxMessagingAdapter implements MessagingAdapter {
  readonly info: AdapterInfo = { kind: 'messaging', provider: 'sandbox-messaging', mode: 'sandbox' };
  readonly outbox: SandboxMessage[] = [];
  /** Test hook: fail the next N sends. */
  failNext = 0;

  private record(m: SandboxMessage) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Sandbox delivery failure');
    }
    this.outbox.unshift(m);
    if (this.outbox.length > 200) this.outbox.pop();
    return { id: `sbx_msg_${randomUUID().slice(0, 12)}` };
  }

  async sendEmail(message: EmailMessage) {
    return this.record({ channel: 'email', at: new Date().toISOString(), message });
  }
  async sendSms(message: SmsMessage) {
    return this.record({ channel: 'sms', at: new Date().toISOString(), message });
  }
  async sendPush(message: PushMessage) {
    return this.record({ channel: 'push', at: new Date().toISOString(), message });
  }
}
