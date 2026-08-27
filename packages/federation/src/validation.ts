import {Ajv2020, type ValidateFunction} from "ajv/dist/2020.js";
import descriptorSchema from "../../../spec/sai/0.2.0/node-descriptor.schema.json" with {type: "json"};
import credentialSchema from "../../../spec/sai/0.2.0/transfer-credential.schema.json" with {type: "json"};
import receiptSchema from "../../../spec/sai/0.2.0/transfer-receipt.schema.json" with {type: "json"};
import cancellationSchema from "../../../spec/sai/0.2.0/transfer-cancellation.schema.json" with {type: "json"};
import prepareSchema from "../../../spec/sai/0.2.0/transfer-prepare-input.schema.json" with {type: "json"};
import type {NodeDescriptor, TransferCancellation, TransferCredential, TransferReceipt} from "./types.js";

const ajv = new Ajv2020({strict: true, formats: {uri: /^(https?):\/\/[^\s]+$/}});
const validators = {
  descriptor: ajv.compile(descriptorSchema),
  credential: ajv.compile(credentialSchema),
  receipt: ajv.compile(receiptSchema),
  cancellation: ajv.compile(cancellationSchema),
  prepare: ajv.compile(prepareSchema),
};

function assertWith<T>(validator: ValidateFunction, value: unknown, label: string): asserts value is T {
  if (!validator(value)) throw new Error(`${label} schema 无效: ${ajv.errorsText(validator.errors)}`);
}

export function assertNodeDescriptor(value: unknown): asserts value is NodeDescriptor { assertWith<NodeDescriptor>(validators.descriptor, value, "node descriptor"); }
export function assertTransferCredential(value: unknown): asserts value is TransferCredential { assertWith<TransferCredential>(validators.credential, value, "transfer credential"); }
export function assertTransferReceipt(value: unknown): asserts value is TransferReceipt { assertWith<TransferReceipt>(validators.receipt, value, "transfer receipt"); }
export function assertTransferCancellation(value: unknown): asserts value is TransferCancellation { assertWith<TransferCancellation>(validators.cancellation, value, "transfer cancellation"); }
export function assertTransferPrepareInput(value: unknown): asserts value is {target_node: string; target_region: string; nonce?: string; ttl?: number} { assertWith(validators.prepare, value, "transfer prepare input"); }
