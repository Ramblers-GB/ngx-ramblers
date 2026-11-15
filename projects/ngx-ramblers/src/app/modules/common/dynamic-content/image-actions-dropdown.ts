import { Component, EventEmitter, inject, Input, Output, ViewChild } from "@angular/core";
import { BsDropdownDirective, BsDropdownMenuDirective, BsDropdownToggleDirective } from "ngx-bootstrap/dropdown";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faImage } from "@fortawesome/free-solid-svg-icons";
import { CmsImagePickerImage } from "../../../models/cms-image-picker.model";
import { CmsImagePickerComponent } from "../cms-image-picker/cms-image-picker";
import { PageService } from "../../../services/page.service";

@Component({
  selector: "app-image-actions-dropdown",
  template: `
    <div class="btn-group" [class.w-100]="fullWidth" dropdown [container]="'body'">
      <button aria-controls="dropdown-image-actions" class="dropdown-toggle {{buttonClass}}" [class.w-100]="fullWidth" dropdownToggle type="button">
        <fa-icon [icon]="faImage"></fa-icon>
        <span class="ms-2">Image Actions</span>
      </button>
      <ul *dropdownMenu class="dropdown-menu" [class.w-100]="fullWidth" id="dropdown-image-actions" role="menu">
        @if (!hasImage) {
          <li role="menuitem">
            <a (click)="edit.emit()" class="dropdown-item">Add image</a>
          </li>
        }
        @if (hasImage) {
          <li role="menuitem">
            <a (click)="edit.emit()" class="dropdown-item">Edit image</a>
          </li>
          <li role="menuitem">
            <a (click)="replace.emit()" class="dropdown-item">Replace image</a>
          </li>
          @if (hasFixedHeight) {
            <li role="menuitem">
              <a (click)="clearHeight.emit()" class="dropdown-item">Reset height</a>
            </li>
          }
          <li role="menuitem">
            <a (click)="remove.emit()" class="dropdown-item text-danger">Remove image</a>
          </li>
        }
        <li role="menuitem">
          <a (click)="openWebsitePicker()" class="dropdown-item">Choose from website</a>
        </li>
      </ul>
    </div>
    <app-cms-image-picker [open]="websitePickerOpen"
                          includeWholeSite
                          [showUploadAction]="false"
                          [startingPagePaths]="resolvedStartingPaths()"
                          [currentImageSrc]="currentImageSrc"
                          (selected)="onWebsiteImageSelected($event)"
                          (closed)="websitePickerOpen = false"/>
  `,
    imports: [BsDropdownDirective, BsDropdownToggleDirective, BsDropdownMenuDirective, FontAwesomeModule, CmsImagePickerComponent]
})
export class ImageActionsDropdownComponent {
  private pageService = inject(PageService);
  @ViewChild(BsDropdownDirective) dropdown: BsDropdownDirective;
  @Input() instanceId: string;
  @Input() fullWidth = false;
  @Input() hasImage = false;
  @Input() hasFixedHeight = false;
  @Input() buttonClass = "badge-button border-0";
  @Input() currentImageSrc: string | null = null;
  @Input() startingPagePaths: string[] = [];
  @Output() edit = new EventEmitter<void>();
  @Output() replace = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() clearHeight = new EventEmitter<void>();
  @Output() websiteImage = new EventEmitter<CmsImagePickerImage>();
  faImage = faImage;
  websitePickerOpen = false;

  openWebsitePicker(): void {
    this.websitePickerOpen = true;
  }

  onWebsiteImageSelected(image: CmsImagePickerImage): void {
    this.websitePickerOpen = false;
    this.websiteImage.emit(image);
  }

  resolvedStartingPaths(): string[] {
    return this.startingPagePaths?.length
      ? this.startingPagePaths
      : [this.pageService.pathSegments().join("/")].filter(Boolean);
  }

  toggleMenu() {
    if (this.dropdown) {
      if (this.dropdown.isOpen) {
        this.dropdown.hide();
      } else {
        this.dropdown.show();
      }
    }
  }
}
