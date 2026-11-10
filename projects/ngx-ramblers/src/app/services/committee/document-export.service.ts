import {HttpClient} from "@angular/common/http";
import {inject, Injectable} from "@angular/core";
import {Observable} from "rxjs";
import {DocumentExportRequest} from "../../models/committee.model";

@Injectable({providedIn: "root"})
export class DocumentExportService {
  private http = inject(HttpClient);

  docx(request: DocumentExportRequest): Observable<Blob> {
    return this.http.post("/api/document-export/docx", request, {responseType: "blob"});
  }
}
