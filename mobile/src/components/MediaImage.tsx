/**
 * Shows a work-log photo.
 *
 * Older notes carry the photo inline as a data URL. Newer ones carry a server
 * reference ("/api/media/<id>"), which needs the server URL and the worker's
 * Bearer token to load.
 */
import React, { useEffect, useState } from 'react';
import { Image, type ImageProps, type ImageSourcePropType } from 'react-native';
import { getServerUrl, getToken } from '@/api/client';

type Props = Omit<ImageProps, 'source'> & { content: string };

export function MediaImage({ content, ...rest }: Props) {
  const [source, setSource] = useState<ImageSourcePropType | null>(
    content.startsWith('/api/') ? null : { uri: content },
  );

  useEffect(() => {
    if (!content.startsWith('/api/')) {
      setSource({ uri: content });
      return;
    }
    let cancelled = false;
    (async () => {
      const [base, token] = await Promise.all([getServerUrl(), getToken()]);
      if (cancelled) return;
      setSource({
        uri: `${base}${content}`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    })();
    return () => { cancelled = true; };
  }, [content]);

  if (!source) return null;
  return <Image source={source} {...rest} />;
}
