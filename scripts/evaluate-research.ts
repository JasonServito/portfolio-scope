import { runVerificationEvaluation } from "../lib/research/ai/verification-evaluation";

const result = await runVerificationEvaluation();
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
