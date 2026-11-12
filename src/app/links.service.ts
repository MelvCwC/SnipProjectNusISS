import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ShortLink } from './short-link';

@Injectable({ providedIn: 'root' })
export class LinksService {
  private readonly http = inject(HttpClient);

  create(url: string): Observable<ShortLink> {
    return this.http.post<ShortLink>('/api/links', { url });
  }

  list(): Observable<ShortLink[]> {
    return this.http.get<ShortLink[]>('/api/links');
  }
}
