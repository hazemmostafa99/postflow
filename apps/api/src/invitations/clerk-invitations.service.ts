import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClerkInvitationsService {
  constructor(private readonly config: ConfigService) {}

  async create(emailAddress: string): Promise<{ id: string }> {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey) throw new BadGatewayException('CLERK_SECRET_KEY is not configured');
    const response = await fetch('https://api.clerk.com/v1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_address: emailAddress, notify: true }),
    });
    if (!response.ok) throw new BadGatewayException('Clerk invitation could not be created');
    return (await response.json()) as { id: string };
  }

  async revoke(id: string): Promise<void> {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey) throw new BadGatewayException('CLERK_SECRET_KEY is not configured');
    const response = await fetch(`https://api.clerk.com/v1/invitations/${id}/revoke`, {
      method: 'POST', headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!response.ok && response.status !== 404) throw new BadGatewayException('Clerk invitation could not be revoked');
  }
}
