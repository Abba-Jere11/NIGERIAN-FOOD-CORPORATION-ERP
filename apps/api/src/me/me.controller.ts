import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import {
  complaintReplySchema,
  complaintSchema,
  directMessageSchema,
  groupMessageSchema,
  messageBodySchema,
  noticeSchema,
  ownLeaveSchema,
  profilePatchSchema,
} from './me.dto';
import { MeService } from './me.service';

@Controller()
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('api/me/summary')
  @ActorOnly()
  summary(@CurrentActor() actor: ActorContext) {
    return this.me.summary(actor);
  }

  @Get('api/me/profile')
  @RequirePermission('self.workspace')
  profile(@CurrentActor() actor: ActorContext) {
    return this.me.profile(actor);
  }

  @Patch('api/me/profile')
  @RequirePermission('self.workspace')
  updateProfile(@CurrentActor() actor: ActorContext, @Body(zodPipe(profilePatchSchema)) body: {
    otherNames?: string | null;
    gender?: string | null;
    personalEmail?: string | null;
    personalPhone?: string | null;
    emergencyName?: string | null;
    emergencyPhone?: string | null;
    rowVersion: number;
  }) {
    return this.me.updateProfile(actor, body);
  }

  @Get('api/me/attendance')
  @RequirePermission('self.workspace')
  attendance(@CurrentActor() actor: ActorContext) {
    return this.me.attendance(actor);
  }

  @Get('api/me/payslips')
  @RequirePermission('self.payslip.view')
  payslips(@CurrentActor() actor: ActorContext) {
    return this.me.payslips(actor);
  }

  @Get('api/me/leave')
  @RequirePermission('self.leave.request')
  leave(@CurrentActor() actor: ActorContext) {
    return this.me.leave(actor);
  }

  @Post('api/me/leave')
  @RequirePermission('self.leave.request')
  requestLeave(@CurrentActor() actor: ActorContext, @Body(zodPipe(ownLeaveSchema)) body: {
    typeKey: string;
    startsOn: string;
    endsOn: string;
    reason?: string | null;
    reliefEmployeeId: string;
    idempotencyKey: string;
  }) {
    return this.me.requestLeave(actor, body);
  }

  @Get('api/me/relief-requests')
  @RequirePermission('self.workspace')
  relief(@CurrentActor() actor: ActorContext) {
    return this.me.reliefInbox(actor);
  }

  @Get('api/directory')
  @RequirePermission('directory.view')
  directory(@CurrentActor() actor: ActorContext, @Query('q') q?: string) {
    return this.me.directory(actor, q ?? '');
  }

  @Get('api/me/notices')
  @RequirePermission('notice.view')
  notices(@CurrentActor() actor: ActorContext) {
    return this.me.notices(actor);
  }

  @Post('api/me/notices/:id/read')
  @RequirePermission('notice.view')
  readNotice(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.me.markNoticeRead(actor, id);
  }

  @Get('api/hr/notices')
  @RequirePermission('notice.manage')
  managedNotices(@CurrentActor() actor: ActorContext) {
    return this.me.listManagedNotices(actor);
  }

  @Post('api/hr/notices')
  @RequirePermission('notice.manage')
  publishNotice(@CurrentActor() actor: ActorContext, @Body(zodPipe(noticeSchema)) body: {
    title: string;
    body: string;
    entityId?: string | null;
    pinned?: boolean;
    audience: { all?: boolean; roles?: string[]; departmentIds?: string[] };
  }) {
    return this.me.publishNotice(actor, body);
  }

  @Get('api/me/complaints')
  @RequirePermission('complaint.submit')
  myComplaints(@CurrentActor() actor: ActorContext) {
    return this.me.complaints(actor);
  }

  @Post('api/me/complaints')
  @RequirePermission('complaint.submit')
  submitComplaint(@CurrentActor() actor: ActorContext, @Body(zodPipe(complaintSchema)) body: {
    category: string;
    subject: string;
    body: string;
    anonymous?: boolean;
  }) {
    return this.me.submitComplaint(actor, { ...body, anonymous: body.anonymous ?? false });
  }

  @Get('api/hr/complaints')
  @RequirePermission('complaint.manage')
  hrComplaints(@CurrentActor() actor: ActorContext) {
    return this.me.complaints(actor);
  }

  @Post('api/hr/complaints/:id/reply')
  @ActorOnly()
  reply(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(complaintReplySchema)) body: { body: string; status?: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED' },
  ) {
    return this.me.replyComplaint(actor, id, body.body, body.status);
  }

  @Get('api/me/messages')
  @RequirePermission('message.use')
  conversations(@CurrentActor() actor: ActorContext) {
    return this.me.conversations(actor);
  }

  @Post('api/me/messages/direct')
  @RequirePermission('message.use')
  direct(@CurrentActor() actor: ActorContext, @Body(zodPipe(directMessageSchema)) body: { userId: string }) {
    return this.me.openDirect(actor, body.userId).then((id) => ({ id }));
  }

  @Post('api/me/messages/group')
  @RequirePermission('message.use')
  group(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(groupMessageSchema)) body: { title: string; memberIds: string[] },
  ) {
    return this.me.openGroup(actor, body.title, body.memberIds).then((id) => ({ id }));
  }

  @Get('api/me/messages/:id')
  @RequirePermission('message.use')
  thread(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.me.messages(actor, id);
  }

  @Post('api/me/messages/:id')
  @RequirePermission('message.use')
  send(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(messageBodySchema)) body: { body: string },
  ) {
    return this.me.sendMessage(actor, id, body.body);
  }
}
