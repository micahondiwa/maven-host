import 'server-only'
import { registerNotificationListeners } from './notifications/service'
import './orders/service'
import { registerHostingFulfiller } from './orders/fulfillment'
import { fulfillHostingItem } from './hosting/service'
import { registerHostingAuditListeners } from './hosting/events'

/** Registers in-process event listeners once per process (web server, worker and tests). */
let started = false
export function bootstrap() {
  if (started) return
  started = true
  registerNotificationListeners()
  registerHostingFulfiller(fulfillHostingItem)
  registerHostingAuditListeners()
}
