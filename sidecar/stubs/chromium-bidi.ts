/**
 * Stub de chromium-bidi para el bundler de bun.
 *
 * playwright-core/lib/coreBundle.js hace `require("chromium-bidi/lib/cjs/...")`
 * en rutas de código que sólo corren en modo BiDi (no lo usamos: YATT controla
 * el navegador por CDP/Playwright estándar). El paquete real no viene como
 * dependencia, así que el bundler falla al resolverlo. Estas clases vacías
 * satisfacen la resolución sin cambiar el comportamiento.
 */

export class CdpConnection {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(..._args: unknown[]) {}
}

export class BidiMapper {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(..._args: unknown[]) {}
}
