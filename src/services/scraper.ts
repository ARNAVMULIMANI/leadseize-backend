import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapedBusiness {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
}

export async function scrapeBusinessInfo(url: string): Promise<ScrapedBusiness> {
  const { data } = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadSeize/1.0)' },
  });

  const $ = cheerio.load(data);

  const name = $('meta[property="og:site_name"]').attr('content') ||
    $('title').text().trim() ||
    '';

  const phone = $('a[href^="tel:"]').first().attr('href')?.replace('tel:', '') || undefined;
  const email = $('a[href^="mailto:"]').first().attr('href')?.replace('mailto:', '') || undefined;

  return { name, phone, email, website: url };
}
