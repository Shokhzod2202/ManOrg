import { Controller, Get, Param, Res } from '@nestjs/common';
import { type Response } from 'express';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { Public } from '../common/request-context';
import { ZodQuery } from '../common/zod';
import { CONTENT_TYPES, parseKey } from './storage-keys';
import { StorageService, verifyFileSignature } from './storage.service';

const signedQuery = z.object({
  expires: z.coerce.number().int(),
  signature: z.string().min(10).max(200),
});

/**
 * Serves stored files for the local driver. The link itself is the credential: it names one file
 * and expires (SIGNED_URL_TTL_SECONDS), like a presigned S3 link. Production uses S3 links instead.
 */
@Public()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Get(':key')
  async get(
    @Param('key') key: string,
    @ZodQuery(signedQuery) query: z.infer<typeof signedQuery>,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = parseKey(key);
    if (!parsed || !verifyFileSignature(key, query.expires, query.signature)) {
      throw Errors.notFound('File');
    }
    const body = await this.storage.readLocal(key);
    if (!body) throw Errors.notFound('File');
    res
      .status(200)
      .set({
        'Content-Type': CONTENT_TYPES[parsed.ext],
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(body);
  }
}
