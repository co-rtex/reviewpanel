import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Webhooks } from '@octokit/webhooks';
import { prisma } from './db.js';

type PullRequestEventAction = 'opened' | 'synchronize' | 'reopened';

function isPullRequestAction(a: unknown): a is PullRequestEventAction {
  return a === 'opened' || a === 'synchronize' || a === 'reopened';
}

@Controller()
export class GithubWebhookController {
  @Post('/webhooks/github')
  @HttpCode(200)
  async handle(
    @Req() req: FastifyRequest,
    @Headers('x-hub-signature-256') sig256?: string,
    @Headers('x-github-event') ghEvent?: string,
    @Headers('x-github-delivery') ghDelivery?: string,
  ) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
    if (!secret) return { ok: false, error: 'missing webhook secret' };

    const rawBody = (req as any).rawBody as string | undefined;
    if (!rawBody) return { ok: false, error: 'rawBody missing (server misconfigured)' };

    const signature = sig256 ?? '';
    const webhooks = new Webhooks({ secret });

    const ok = await webhooks.verify(rawBody, signature);
    if (!ok) return { ok: false, error: 'invalid signature' };

    // Parse JSON body (rawBody is string)
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: 'invalid JSON payload' };
    }

    // Only handle PR events for now
    if (ghEvent !== 'pull_request') {
      return { ok: true, ignored: true, reason: 'unsupported event', event: ghEvent ?? null };
    }

    const action = payload?.action;
    if (!isPullRequestAction(action)) {
      return { ok: true, ignored: true, reason: 'unsupported action', action: action ?? null };
    }

    // Extract required fields (fail closed)
    const installationId = payload?.installation?.id;
    const repoId = payload?.repository?.id;
    const repoFullName = payload?.repository?.full_name;
    const repoOwner = payload?.repository?.owner?.login;
    const repoName = payload?.repository?.name;

    const prId = payload?.pull_request?.id;
    const prNumber = payload?.pull_request?.number;
    const prHeadSha = payload?.pull_request?.head?.sha;
    const prBaseSha = payload?.pull_request?.base?.sha;
    const prTitle = payload?.pull_request?.title;
    const prBody = payload?.pull_request?.body ?? null;
    const prAuthor = payload?.pull_request?.user?.login ?? null;
    const prUrl = payload?.pull_request?.html_url;
    const prState = payload?.pull_request?.state;

    if (
      !installationId || !repoId || !repoFullName || !repoOwner || !repoName ||
      !prId || typeof prNumber !== 'number' ||
      !prHeadSha || !prBaseSha || !prTitle || !prUrl || !prState
    ) {
      return { ok: false, error: 'missing required fields' };
    }

    // Upsert Installation + Repo + PR (id fields stored as strings in our schema)
    const installationIdStr = String(installationId);
    const repoIdStr = String(repoId);
    const prIdStr = String(prId);

    await prisma.installation.upsert({
      where: { id: installationIdStr },
      update: {
        accountLogin: payload?.installation?.account?.login ?? null,
        accountType: payload?.installation?.account?.type ?? null,
      },
      create: {
        id: installationIdStr,
        accountLogin: payload?.installation?.account?.login ?? null,
        accountType: payload?.installation?.account?.type ?? null,
      },
    });

    await prisma.repo.upsert({
      where: { id: repoIdStr },
      update: {
        owner: repoOwner,
        name: repoName,
        fullName: repoFullName,
        installationId: installationIdStr,
      },
      create: {
        id: repoIdStr,
        owner: repoOwner,
        name: repoName,
        fullName: repoFullName,
        installationId: installationIdStr,
      },
    });

    await prisma.pullRequest.upsert({
      where: { id: prIdStr },
      update: {
        repoId: repoIdStr,
        number: prNumber,
        headSha: prHeadSha,
        baseSha: prBaseSha,
        title: prTitle,
        body: prBody,
        authorLogin: prAuthor,
        url: prUrl,
        state: prState,
      },
      create: {
        id: prIdStr,
        repoId: repoIdStr,
        number: prNumber,
        headSha: prHeadSha,
        baseSha: prBaseSha,
        title: prTitle,
        body: prBody,
        authorLogin: prAuthor,
        url: prUrl,
        state: prState,
      },
    });

    const run = await prisma.run.create({
      data: {
        repoId: repoIdStr,
        prId: prIdStr,
        installationId: installationIdStr,
        triggerEvent: `pull_request.${action}`,
        headSha: prHeadSha,
        status: 'QUEUED',
        startedAt: new Date(),
        contextPackage: {
          delivery: ghDelivery ?? null,
          event: ghEvent ?? null,
          action,
          receivedAt: new Date().toISOString(),
        },
      },
      select: { id: true, status: true, triggerEvent: true },
    });

    return { ok: true, run };
  }
}
