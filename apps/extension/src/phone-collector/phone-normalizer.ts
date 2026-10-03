type PhoneNumberNormalizationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: string };

interface NormalizedPhoneCandidates {
  numbers: PhoneReviewNumber[];
  summary: PhoneCollectionSummary;
}

// Validates candidates for the review screen and keeps only unique valid E.164 numbers.
function normalizeAndDeduplicatePhoneCandidates(
  candidates: PhoneCollectionCandidate[],
): NormalizedPhoneCandidates {
  const numbers: PhoneReviewNumber[] = [];
  const seenNumbers = new Set<string>();
  let valid = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const candidate of candidates) {
    const result = normalizePhoneNumber(candidate.raw);
    if (!result.valid) {
      invalid += 1;
      continue;
    }

    if (seenNumbers.has(result.normalized)) {
      duplicates += 1;
      continue;
    }

    seenNumbers.add(result.normalized);
    valid += 1;
    numbers.push({
      id: candidate.id,
      raw: candidate.raw,
      value: result.normalized,
      normalized: result.normalized,
      status: "valid",
      selected: true,
    });
  }

  return {
    numbers,
    summary: {
      found: candidates.length,
      valid,
      duplicates,
      invalid,
    },
  };
}

// Parses one number using Egypt for national-format input and respects international country codes.
function normalizePhoneNumber(raw: string): PhoneNumberNormalizationResult {
  const input = normalizePhoneInput(raw);
  if (!input) return { valid: false, reason: "No phone number was found." };

  try {
    const parsed = libphonenumber.parsePhoneNumber(input, {
      defaultCountry: "EG",
      extract: false,
    });
    if (!parsed.isValid()) {
      return { valid: false, reason: "Number is not valid for its country." };
    }
    return { valid: true, normalized: parsed.number };
  } catch {
    return { valid: false, reason: "Could not parse this value as a phone number." };
  }
}

// Converts Unicode decimal digits and international 00 prefixes into parser-friendly input.
function normalizePhoneInput(value: string): string {
  const asciiDigits = Array.from(value.normalize("NFKC"), (character) =>
    /\p{Nd}/u.test(character) ? libphonenumber.parseDigits(character) : character,
  ).join("");
  return asciiDigits.trim().replace(/^00(?=\d)/, "+");
}
