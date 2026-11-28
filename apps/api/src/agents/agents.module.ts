import { Module } from '@nestjs/common';
import { AgentKeysController } from './agent-keys.controller';
import { AgentKeysService } from './agent-keys.service';

/** Decided 2026-11-29: API keys for outside bots. Exported for the sign-in guard. */
@Module({
  controllers: [AgentKeysController],
  providers: [AgentKeysService],
  exports: [AgentKeysService],
})
export class AgentsModule {}
