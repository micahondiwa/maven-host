import 'server-only'
import { AllowAny, json, Router, type Context } from '../http/router'
import { notFound } from '../http/errors'
import { f, invalid, validate } from '../http/validation'
import * as websites from '../websites/service'
import { requestPublication } from '../websites/publish'
import { activateTrial, trialForWebsite } from '../websites/trials'
import { analyzeWebsite, latestAnalysis } from '../seo/analyzer'
import { generateWebsite } from '../ai/website-generation'
import { AIProviderError } from '../ai/provider'
import { answerChat } from '../ai/chat'
import * as publicGeneration from '../ai/public-generation'

function slugField(required: boolean) {
  const field = f.string({ maxLength: 160 }).check((value) => {
    if (!/^[-a-zA-Z0-9_]+$/.test(value)) invalid('Enter a valid "slug" consisting of letters, numbers, underscores or hyphens.')
  })
  return required ? field : field.optional()
}

const website = (ctx: Context) => websites.ownedWebsite(ctx.params.website_id, ctx.authenticatedUser.id)

const pageSchema = (partial: boolean) => ({
  slug: slugField(!partial),
  title: f.string({ maxLength: 200 }),
  page_type: f.string({ maxLength: 50 }).optional(),
  content: f.json().optional(),
  seo_title: f.string({ maxLength: 60, allowBlank: true }).optional(),
  seo_description: f.string({ maxLength: 160, allowBlank: true }).optional(),
  sort_order: f.integer({ min: 0, max: 2147483647 }).optional(),
  is_published: f.boolean().optional(),
})

const websiteSchema = (create: boolean) => ({
  name: create ? f.string({ maxLength: 150 }) : f.string({ maxLength: 150 }).optional(),
  slug: slugField(false),
  domain_id: f.uuid().nullable().optional(),
  hosting_account_id: f.integer().nullable().optional(),
})

function providerFailure(error: AIProviderError) {
  const status = ({ timeout: 504, provider_rejected: 502, invalid_response: 502, invalid_structured_output: 502, empty_response: 502, refused: 502 } as Record<string, number>)[error.code] ?? 503
  return json({ detail: error.message }, status)
}

async function generate(ctx: Context) {
  await website(ctx)
  const data = validate({ brief: f.string({ maxLength: 4000 }) }, await ctx.body())
  try {
    return await generateWebsite(ctx.params.website_id, ctx.authenticatedUser.id, data.brief)
  } catch (error) {
    if (error instanceof AIProviderError) return providerFailure(error)
    throw error
  }
}

async function seoLatest(ctx: Context) {
  await website(ctx)
  const analysis = await latestAnalysis(ctx.params.website_id)
  if (!analysis) throw notFound('No SEO analysis exists for this website.')
  return analysis
}

async function seoAnalyze(ctx: Context) {
  await website(ctx)
  return analyzeWebsite(ctx.params.website_id)
}

/** apps/websites/api/urls.py (including the SEO and AI generation views it mounts). */
export const websiteRoutes = new Router()
  .get('templates/', () => websites.listTemplates())
  .get('', (ctx) => websites.listWebsites(ctx.authenticatedUser.id))
  .post('', async (ctx) => {
    const data = validate(websiteSchema(true), await ctx.body())
    return json(await websites.websiteData(await websites.createWebsite(ctx.authenticatedUser.id, data)), 201)
  })
  .get('<uuid:website_id>/', async (ctx) => websites.websiteData(await website(ctx)))
  .patch('<uuid:website_id>/', async (ctx) => {
    const current = await website(ctx)
    const data = validate(websiteSchema(false), await ctx.body(), { partial: true })
    return websites.websiteData(await websites.updateWebsite(current, data))
  })
  .delete('<uuid:website_id>/', async (ctx) => {
    await websites.archiveWebsite(await website(ctx))
    return undefined
  })
  .post('<uuid:website_id>/generate/', generate, { throttle: 'ai_generation' })
  .post('<uuid:website_id>/publish/', async (ctx) => {
    await website(ctx)
    return json(await websites.websiteData(await requestPublication(ctx.params.website_id)), 202)
  }, { throttle: 'website_publish' })
  .get('<uuid:website_id>/trial/', async (ctx) => {
    await website(ctx)
    return trialForWebsite(ctx.params.website_id)
  })
  .post('<uuid:website_id>/trial/activate/', async (ctx) => {
    await website(ctx)
    return json(await activateTrial(ctx.params.website_id), 202)
  })
  .get('<uuid:website_id>/seo/', seoLatest, { throttle: 'seo_analysis' })
  .post('<uuid:website_id>/seo/', seoAnalyze, { throttle: 'seo_analysis' })
  .get('<uuid:website_id>/seo/analyze/', seoLatest, { throttle: 'seo_analysis' })
  .post('<uuid:website_id>/seo/analyze/', seoAnalyze, { throttle: 'seo_analysis' })
  .get('<uuid:website_id>/pages/', async (ctx) => (await websites.websitePages((await website(ctx)).id)).map(websites.pageData))
  .post('<uuid:website_id>/pages/', async (ctx) => {
    const current = await website(ctx)
    const data = validate(pageSchema(false), await ctx.body())
    return json(websites.pageData(await websites.createPage(current.id, data as websites.PageInput)), 201)
  })
  .get('<uuid:website_id>/pages/<uuid:page_id>/', async (ctx) => websites.pageData(await websites.ownedPage((await website(ctx)).id, ctx.params.page_id)))
  .patch('<uuid:website_id>/pages/<uuid:page_id>/', async (ctx) => {
    const page = await websites.ownedPage((await website(ctx)).id, ctx.params.page_id)
    const data = validate(pageSchema(true), await ctx.body(), { partial: true })
    return websites.pageData(await websites.updatePage(page, data))
  })
  .delete('<uuid:website_id>/pages/<uuid:page_id>/', async (ctx) => {
    await websites.deletePage(await websites.ownedPage((await website(ctx)).id, ctx.params.page_id))
    return undefined
  })

const visitorHeader = (ctx: Context) => ctx.header('x-maven-visitor-token') ?? ''

/** apps/ai/api/urls.py */
export const aiRoutes = new Router()
  .post('chat/', async (ctx) => {
    const data = validate(
      {
        messages: f.list(f.object({ role: f.choice(['user', 'assistant'] as const), content: f.string({ maxLength: 4000 }) }), { allowEmpty: false }).check((messages) => {
          if (messages.length > 20) invalid('A maximum of 20 messages may be sent.')
          if (messages[messages.length - 1].role !== 'user') invalid('The latest message must be from the user.')
        }),
      },
      await ctx.body(),
    ).messages
    try {
      return { answer: await answerChat(data) }
    } catch (error) {
      if (!(error instanceof AIProviderError)) throw error
      return json({ detail: error.message }, error.code === 'invalid_request' ? 400 : 503)
    }
  }, { permissions: [AllowAny], throttle: 'chatbot' })
  .post('websites/<uuid:website_id>/generate/', generate, { throttle: 'ai_generation' })
  .post('public/website-generations/', async (ctx) => {
    const data = validate({ brief: f.string({ minLength: 20, maxLength: 2000 }), visitor_token: f.string({ maxLength: 500 }).optional() }, await ctx.body())
    const token = data.visitor_token || publicGeneration.issueVisitorToken()
    try {
      const generation = await publicGeneration.generatePublicWebsite(data.brief, token, ctx.ip)
      return json(publicGeneration.generationData(generation, token), 201)
    } catch (error) {
      if (error instanceof publicGeneration.PublicGenerationError) return json({ detail: error.message }, publicGeneration.publicErrorStatus(error))
      throw error
    }
  }, { permissions: [AllowAny], throttle: 'public_ai_generation' })
  .get('public/website-generations/<uuid:generation_id>/', async (ctx) => {
    try {
      return publicGeneration.generationData(await publicGeneration.retrievePublicGeneration(ctx.params.generation_id, visitorHeader(ctx)), visitorHeader(ctx))
    } catch (error) {
      if (error instanceof publicGeneration.PublicGenerationError) return json({ detail: error.message }, 404)
      throw error
    }
  }, { permissions: [AllowAny] })
  .post('public/website-generations/<uuid:generation_id>/claim/', async (ctx) => {
    try {
      return json(await publicGeneration.claimPublicGeneration(ctx.params.generation_id, visitorHeader(ctx), ctx.authenticatedUser.id), 201)
    } catch (error) {
      if (error instanceof publicGeneration.PublicGenerationError) return json({ detail: error.message }, 409)
      throw error
    }
  })

