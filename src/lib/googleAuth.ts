import { google } from "googleapis";

export function createGoogleJwt(scopes: string[] = []) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes,
  });
}

export default createGoogleJwt;
