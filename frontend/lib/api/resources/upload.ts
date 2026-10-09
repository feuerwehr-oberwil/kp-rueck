/**
 * The multipart photo POST shared by the Reko and Rapport photo doors.
 */

import { getApiUrl } from '../../env'
import { translateOutsideReact } from '../../i18n-messages'
import { markRestReachable, PHOTO_UPLOAD_TIMEOUT_MS } from '../http'
import { messageForErrorCode } from '../error-codes'
import { NetworkError } from '../types'

/** How far one photo has got, 0…1. Fed by `XMLHttpRequest.upload.onprogress`. */
export type PhotoUploadProgress = (fraction: number) => void

/**
 * The multipart photo POST, shared by every photo door.
 *
 * `request()` is JSON-only, and a phone photo needs its own timeout and its
 * own error unwrapping (file size, quota, invalid type all come back as a
 * German `detail` the user has to see). One copy of that, not one per door.
 *
 * **`XMLHttpRequest`, not `fetch`, and only because of `onProgress`.** A
 * storm photo on rural LTE takes half a minute, and `fetch` cannot say how
 * far it got — the request either resolves or, sixty seconds later, does not.
 * That is what a bar per photo needs, and the bar is what turns "4 Fotos
 * konnten nicht hochgeladen werden" into something a crew can act on.
 *
 * One attempt. Retrying is the caller's business (`components/reko/photo-upload.tsx`),
 * because it is the caller that keeps the file and shows which photo is on
 * its second try.
 */
export function uploadPhotoFile<T>(
  path: string,
  file: File,
  headers: Record<string, string> = {},
  onProgress?: PhotoUploadProgress,
): Promise<T> {
  const formData = new FormData()
  formData.append('file', file)

  const url = `${getApiUrl()}${path}`

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true // Include auth cookies
    xhr.timeout = PHOTO_UPLOAD_TIMEOUT_MS
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)

    if (onProgress) {
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
      }
    }

    xhr.onload = () => {
      // The server answered (any status): the connection works.
      markRestReachable()
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T)
        } catch {
          reject(new Error(translateOutsideReact('errors.api.photoUploadFailed')))
        }
        return
      }
      // Backend error messages are German and specific (file size, quota,
      // invalid type) — the crew has to see them, not a status code.
      let message = translateOutsideReact('errors.api.photoUploadFailed')
      try {
        const body = JSON.parse(xhr.responseText) as { detail?: unknown }
        const detail = body.detail
        // A coded error (size, type, limit) in the crew's language first.
        const localized = messageForErrorCode(body)
        if (localized) message = localized
        else if (detail) message = typeof detail === 'string' ? detail : JSON.stringify(detail)
      } catch {
        // Not JSON — keep the generic message.
      }
      reject(new Error(message))
    }
    xhr.onerror = () => reject(new NetworkError())
    xhr.ontimeout = () => reject(new Error(translateOutsideReact('errors.api.uploadTimeout')))
    xhr.onabort = () => reject(new NetworkError())

    xhr.send(formData)
  })
}
