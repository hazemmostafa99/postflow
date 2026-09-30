interface PhoneNumberLibraryResult {
  number: string;
  isValid(): boolean;
}

interface PhoneNumberLibraryApi {
  parseDigits(value: string): string;
  parsePhoneNumber(
    value: string,
    options: { defaultCountry: "EG"; extract: false },
  ): PhoneNumberLibraryResult;
}

declare const libphonenumber: PhoneNumberLibraryApi;
