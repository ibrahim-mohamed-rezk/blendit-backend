import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiOptions } from 'cloudinary';

export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  resourceType: string;
};

@Injectable()
export class CloudinaryService {
  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  private ensureConfigured() {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new InternalServerErrorException(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    options: UploadApiOptions = {},
  ): Promise<CloudinaryUploadResult> {
    this.ensureConfigured();

    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (error, uploaded) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(uploaded);
      });
      stream.end(buffer);
    });

    return {
      secureUrl: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
    };
  }
}
