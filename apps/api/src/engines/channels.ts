/**
 * Delivery channels not built in M3. Later milestones may implement these.
 */
export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

export interface WhatsAppSender {
  send(to: string, body: string): Promise<void>;
}

export class UnimplementedSmsSender implements SmsSender {
  async send(): Promise<void> {
    throw new Error('SMS delivery is not configured in this milestone.');
  }
}

export class UnimplementedWhatsAppSender implements WhatsAppSender {
  async send(): Promise<void> {
    throw new Error('WhatsApp delivery is not configured in this milestone.');
  }
}
