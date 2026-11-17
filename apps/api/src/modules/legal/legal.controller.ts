import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { LegalDocumentType } from '@kobrax/shared';
import { Public } from '../auth/decorators/authz.decorator';
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
  constructor(private readonly legal: LegalService) {}

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
