import { getGlobalConfig } from '../../config/global';
import type { RenovateConfig } from '../../config/types';
import { logger } from '../../logger';
import { platform } from '../../platform';
import { BranchStatus } from '../../types';
import { mergeBranch } from '../../util/git';
import { resolveBranchStatus } from './status-checks';

export type AutomergeResult =
  | 'automerged'
  | 'automerge aborted - PR exists'
  | 'branch status error'
  | 'failed'
  | 'no automerge'
  | 'stale'
  | 'not ready';

export async function tryBranchAutomerge(
  config: RenovateConfig
): Promise<AutomergeResult> {
  logger.debug('Checking if we can automerge branch');
  if (!(config.automerge && config.automergeType === 'branch')) {
    return 'no automerge';
  }
  const existingPr = await platform.getBranchPr(config.branchName);
  if (existingPr) {
    return 'automerge aborted - PR exists';
  }
  const branchStatus = await resolveBranchStatus(
    config.branchName,
    config.ignoreTests
  );
  if (branchStatus === BranchStatus.green) {
    logger.debug(`Automerging branch`);
    try {
      if (getGlobalConfig().dryRun) {
        logger.info('DRY-RUN: Would automerge branch' + config.branchName);
      } else {
        await mergeBranch(config.branchName);
      }
      logger.info({ branch: config.branchName }, 'Branch automerged');
      return 'automerged'; // Branch no longer exists
    } catch (err) /* istanbul ignore next */ {
      if (err.message === 'not ready') {
        logger.debug('Branch is not ready for automerge');
        return 'not ready';
      }
      if (
        err.message.includes('refusing to merge unrelated histories') ||
        err.message.includes('Not possible to fast-forward') ||
        err.message.includes(
          'Updates were rejected because the tip of your current branch is behind'
        )
      ) {
        logger.debug({ err }, 'Branch automerge error');
        logger.info('Branch is not up to date - cannot automerge');
        return 'stale';
      }
      if (err.message.includes('Protected branch')) {
        if (err.message.includes('status check')) {
          logger.debug(
            { err },
            'Branch is not ready for automerge: required status checks are remaining'
          );
          return 'not ready';
        }
        if (err.stack?.includes('reviewers')) {
          logger.info(
            { err },
            'Branch automerge is not possible due to branch protection (required reviewers)'
          );
          return 'failed';
        }
        logger.info(
          { err },
          'Branch automerge is not possible due to branch protection'
        );
        return 'failed';
      }
      logger.warn({ err }, 'Unknown error when attempting branch automerge');
      return 'failed';
    }
  } else if (branchStatus === BranchStatus.red) {
    return 'branch status error';
  } else {
    logger.debug(`Branch status is "${branchStatus}" - skipping automerge`);
  }
  return 'no automerge';
}
