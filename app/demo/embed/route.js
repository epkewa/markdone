import { socialEmbed } from "../../../lib/social-embed";

export function GET(request) {
  return socialEmbed(request.nextUrl.searchParams.get("url"));
}
