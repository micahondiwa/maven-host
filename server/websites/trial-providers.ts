import 'server-only'
import { AwsClient } from 'aws4fetch'

/** Port of apps/websites/providers: Cloudflare R2 storage for seven-day trials (served by infra/trial-worker). */

export type StaticFile = { name: string; content: string | Uint8Array; contentType: string }
export type TrialDeploymentRequest = { trialId: string; hostname: string; files: StaticFile[]; idempotencyKey: string }
export type TrialDeploymentResult = { deploymentId: string; hostname: string; fileCount: number }

export class TrialDeploymentError extends Error {
  constructor(message: string, readonly code = 'trial_deployment_error', readonly ambiguous = false) {
    super(message)
  }
}

export interface TrialProvider {
  deploy(request: TrialDeploymentRequest): Promise<TrialDeploymentResult>
  delete(trialId: string): Promise<void>
}

export class FakeTrialProvider implements TrialProvider {
  static deployments = new Map<string, TrialDeploymentRequest>()
  async deploy(request: TrialDeploymentRequest) {
    FakeTrialProvider.deployments.set(request.trialId, request)
    return { deploymentId: `fake:${request.trialId}`, hostname: request.hostname, fileCount: request.files.length }
  }
  async delete(trialId: string) {
    FakeTrialProvider.deployments.delete(trialId)
  }
}

export class CloudflareR2TrialProvider implements TrialProvider {
  private readonly client: AwsClient
  private readonly base: string

  constructor() {
    const endpoint = process.env.TRIAL_R2_ENDPOINT?.trim() ?? ''
    const accessKeyId = process.env.TRIAL_R2_ACCESS_KEY_ID?.trim() ?? ''
    const secretAccessKey = process.env.TRIAL_R2_SECRET_ACCESS_KEY?.trim() ?? ''
    const bucket = process.env.TRIAL_R2_BUCKET?.trim() ?? ''
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new TrialDeploymentError('Trial hosting provider is not configured.', 'not_configured')
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' })
    this.base = `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(bucket)}`
  }

  private key(trialId: string, filename: string) {
    const clean = filename.replace(/^\/+/, '').replace(/\\/g, '/')
    if (clean.split('/').includes('..')) throw new TrialDeploymentError('Invalid trial artifact path.', 'invalid_artifact')
    return `trials/${trialId}/${clean}`
  }

  private objectUrl(key: string) {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  private async send(url: string, init: RequestInit) {
    const response = await this.client.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`R2 responded ${response.status}`)
    return response
  }

  async deploy(request: TrialDeploymentRequest) {
    try {
      // Generations are versioned upstream; clear prior objects so removed pages cannot remain public.
      await this.delete(request.trialId)
      for (const file of request.files)
        await this.send(this.objectUrl(this.key(request.trialId, file.name)), {
          method: 'PUT',
          body: typeof file.content === 'string' ? file.content : Buffer.from(file.content),
          headers: { 'Content-Type': file.contentType, 'Cache-Control': 'public, max-age=300' },
        })
    } catch (error) {
      if (error instanceof TrialDeploymentError && error.code === 'invalid_artifact') throw error
      console.error(`Trial deployment failed for ${request.trialId}`, error)
      throw new TrialDeploymentError('The trial website could not be published.', 'provider_unavailable', true)
    }
    return { deploymentId: `r2:${request.trialId}:${request.idempotencyKey.slice(0, 16)}`, hostname: request.hostname, fileCount: request.files.length }
  }

  async delete(trialId: string) {
    try {
      let token: string | undefined
      do {
        const params = new URLSearchParams({ 'list-type': '2', prefix: `trials/${trialId}/` })
        if (token) params.set('continuation-token', token)
        const listing = await (await this.send(`${this.base}?${params}`, { method: 'GET' })).text()
        const keys = [...listing.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => decodeXml(match[1]))
        for (const key of keys) await this.send(this.objectUrl(key), { method: 'DELETE' })
        token = /<IsTruncated>true<\/IsTruncated>/.test(listing) ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(listing)?.[1] ?? '') || undefined : undefined
      } while (token)
    } catch (error) {
      console.error(`Trial cleanup failed for ${trialId}`, error)
      throw new TrialDeploymentError('The trial website could not be removed from public hosting.', 'cleanup_failed', true)
    }
  }
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

export function trialProvider(): TrialProvider {
  const name = process.env.TRIAL_DEPLOYMENT_PROVIDER?.trim() || 'fake'
  if (name === 'cloudflare_r2') return new CloudflareR2TrialProvider()
  if (name === 'fake') return new FakeTrialProvider()
  throw new Error(`Unsupported trial deployment provider '${name}'.`)
}
