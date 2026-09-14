// Node hashing adapter; browser-safe schema lives in the shared contract.
import {createHash} from 'node:crypto';
import {specificationBindingCanonical,validateNativeSpecificationReceiptFields} from './native-specification-contract.mjs';
export * from './native-specification-contract.mjs';
export function specificationRequestHash(request) {
  return createHash('sha256').update(specificationBindingCanonical(request),'utf8').digest('hex');
}
export function validateNativeSpecificationReceipt(value,raw) {
  return validateNativeSpecificationReceiptFields(value,raw,raw?specificationRequestHash(raw):undefined);
}
