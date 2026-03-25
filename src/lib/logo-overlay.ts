export type LogoVariant = 'light' | 'dark'

export type LogoPosition =
    | 'tl' | 'tc' | 'tr'
    | 'cl' | 'cc' | 'cr'
    | 'bl' | 'bc' | 'br'

export const LOGO_POSITIONS: LogoPosition[] = [
    'tl', 'tc', 'tr',
    'cl', 'cc', 'cr',
    'bl', 'bc', 'br',
]

export const POSITION_LABELS: Record<LogoPosition, string> = {
    tl: 'TL', tc: 'TC', tr: 'TR',
    cl: 'CL', cc: 'CC', cr: 'CR',
    bl: 'BL', bc: 'BC', br: 'BR',
}

/**
 * Composites a logo onto an image at a given position.
 * Logo sizing: 12% of image width, 3% padding from edges.
 */
export async function applyLogoToImage(
    imageUrl: string,
    logoUrl: string,
    position: LogoPosition,
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)

            const logo = new window.Image()
            logo.crossOrigin = 'anonymous'
            logo.onload = () => {
                const logoW = Math.round(canvas.width * 0.12)
                const logoH = Math.round(logoW * (logo.naturalHeight / logo.naturalWidth))
                const pad = Math.round(canvas.width * 0.03)

                let x = pad, y = pad
                if (position.endsWith('c')) x = (canvas.width - logoW) / 2
                if (position.endsWith('r')) x = canvas.width - logoW - pad
                if (position.startsWith('c')) y = (canvas.height - logoH) / 2
                if (position.startsWith('b')) y = canvas.height - logoH - pad

                ctx.drawImage(logo, x, y, logoW, logoH)
                canvas.toBlob(
                    (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
                    'image/png',
                )
            }
            logo.onerror = () => reject(new Error('Failed to load logo'))
            logo.src = logoUrl
        }
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = imageUrl
    })
}

/**
 * Auto-detect whether to use light or dark logo variant based on image brightness.
 * Samples the bottom-right 15% of the image.
 */
export async function detectLogoVariant(imageUrl: string): Promise<LogoVariant> {
    return new Promise((resolve) => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)

            const sampleX = Math.floor(canvas.width * 0.85)
            const sampleY = Math.floor(canvas.height * 0.85)
            const sampleW = canvas.width - sampleX
            const sampleH = canvas.height - sampleY
            const data = ctx.getImageData(sampleX, sampleY, sampleW, sampleH).data

            let totalBrightness = 0
            const pixelCount = data.length / 4
            for (let i = 0; i < data.length; i += 4) {
                totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
            }
            const avgBrightness = totalBrightness / pixelCount

            resolve(avgBrightness < 128 ? 'light' : 'dark')
        }
        img.onerror = () => resolve('light')
        img.src = imageUrl
    })
}
