# OpenRouter Evaluation Harness

This package provides a local evaluation harness for OpenRouter LLM integrations, emulating Quillen LLM call patterns while capturing cost and quality metrics.

## Setup
1. Install dependencies:
   `pnpm install`
2. Set environment variables in `.env`:
   `OPENROUTER_API_KEY=your_key_here`
   (Optional) `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`

## Running Evaluations
From the project root:
   `pnpm openrouter:eval --category standard`

Arguments:
   `--category` (required): free | standard | advanced | ultra
   `--fixture` (optional): path to custom fixture
   `--output` (optional): custom output path

## Configuration
Category mappings are defined in `src/mapping.ts`. Each category specifies:
   - deriveModel
   - rankerModel
   - draftCandidateModels[]
   - synthesizerModel
   - (optional) judgeModel

## Testing
Unit tests are in `__tests__/` and can be run with:
   `pnpm test`

## Output
Results are saved in `scripts/openrouter-eval/out/` as both human-readable tables and JSON artifacts.