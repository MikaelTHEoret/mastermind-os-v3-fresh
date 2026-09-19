import {createHash} from 'node:crypto';
import {reviewCanonical,validateNativeReviewReceipt as fields,nativeReviewContent} from './native-review-contract.mjs';
export * from './native-review-contract.mjs';
export const reviewContentHash=content=>createHash('sha256').update(reviewCanonical(content)).digest('hex');
export function validateNativeReviewReceipt(value,input) {
  const result=fields(value,input);
  if(input&&result.contentSha256!==reviewContentHash(nativeReviewContent(input)))throw Error('TASK_REVIEW_CONTENT_CHANGED');
  return result;
}
