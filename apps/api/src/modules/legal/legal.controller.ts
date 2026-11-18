import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LegalConsentPurpose, LegalDocumentType } from '@kobrax/shared';
import { Authenticated, Public } from '../auth/decorators/authz.decorator';
import { ConsentDto, ReacceptDto } from './dto/legal-self.dto';
import { legalRequestMeta } from './legal-request';
import { LegalSelfService } from './legal-self.service';
import { LegalService } from './legal.service';

/** Slug público → tipo. Los enlaces permanentes son `/legal/documents/terms/...`, no el nombre interno del enum. */
const SLUG_TO_TYPE: Record<string, LegalDocumentType> = {
  terms: LegalDocumentType.TERMS,
  privacy: LegalDocumentType.PRIVACY,
  cookies: LegalDocumentType.COOKIES,
  dpa: LegalDocumentType.DPA,
  'acceptable-use': LegalDocumentType.ACCEPTABLE_USE,
  'ai-policy': LegalDocumentType.AI_POLICY,
};

function typeOf(slug: string): LegalDocumentType {
  const t = SLUG_TO_TYPE[slug];
  if (!t)
    throw new BadRequestException({ code: 'LEGAL_DOCUMENT_UNKNOWN', message: 'Documento legal desconocido' });
  return t;
}

const localeOf = (q?: string) => (q === 'en' ? 'en' : 'es');

/** Lectura pública de los documentos legales: tienen que poder leerse **antes** de crear la cuenta. Solo lectura. */
@Controller('legal')
export class LegalController {
  constructor(
    private readonly legal: LegalService,
    private readonly self: LegalSelfService,
  ) {}

  // ── Lo propio de cada persona (Mi perfil › Privacidad y re-aceptación). Sin permiso: cada quien solo toca lo suyo, la clave sale de la sesión.

  /** Pendientes de re-aceptación, historial de aceptaciones y estado de cada consentimiento opcional. */
  @Get('me')
  @Authenticated()
  me() {
    return this.self.overview();
  }

  /** Acepta los Términos y reconoce la Política vigentes (cuando cambió algo material). Idempotente. */
  @Post('acceptances')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  reaccept(@Body() dto: ReacceptDto, @Req() req: Request) {
    return this.self.reaccept(dto, legalRequestMeta(req, 'reaccept'));
  }

  /** Otorga o retira un consentimiento opcional. Siempre deja una fila nueva de evidencia. */
  @Put('consents/:purpose')
  @Authenticated()
  setConsent(@Param('purpose') purpose: string, @Body() dto: ConsentDto, @Req() req: Request) {
    if (!(Object.values(LegalConsentPurpose) as string[]).includes(purpose))
      throw new BadRequestException({ code: 'LEGAL_CONSENT_UNKNOWN', message: 'Finalidad desconocida' });
    return this.self.setConsent(purpose as LegalConsentPurpose, dto.granted, legalRequestMeta(req, 'profile'));
  }

  /** Las versiones vigentes de lo que se acepta al registrarse (Términos y Privacidad). */
  @Get('signup-documents')
  @Public()
  signupDocuments(@Query('locale') locale?: string) {
    return this.legal.currentSignupDocuments(localeOf(locale));
  }

  @Get('documents/:slug/current')
  @Public()
  current(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.legal.getCurrent(typeOf(slug), localeOf(locale));
  }

  @Get('documents/:slug/versions')
  @Public()
  versions(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.legal.listVersions(typeOf(slug), localeOf(locale));
  }

  @Get('documents/:slug/versions/:version')
  @Public()
  version(@Param('slug') slug: string, @Param('version') version: string, @Query('locale') locale?: string) {
    return this.legal.getVersion(typeOf(slug), version, localeOf(locale));
  }
}
