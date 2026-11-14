import { instagramEmbed } from "../../../lib/instagram-embed";

export function GET(request) {
  return instagramEmbed(request.nextUrl.searchParams.get("url"));
}
