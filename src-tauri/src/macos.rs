//! Small AppKit integrations that Tauri does not expose directly.

use objc2::ffi::NSUInteger;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::{NSData, NSString};
use std::sync::OnceLock;

/// Marks the window as having unsaved changes (dot in the close button) and
/// sets the proxy icon / represented file in the title bar.
pub fn set_document_state(ns_window: *mut std::ffi::c_void, edited: bool, path: Option<&str>) {
    if ns_window.is_null() {
        return;
    }
    let window = ns_window as *mut AnyObject;
    unsafe {
        let _: () = msg_send![window, setDocumentEdited: edited];
        let path = NSString::from_str(path.unwrap_or(""));
        let _: () = msg_send![window, setRepresentedFilename: &*path];
    }
}

/// First entry of the user's preferred languages, e.g. "ja-JP".
pub fn preferred_language() -> String {
    unsafe {
        let langs: Option<Retained<AnyObject>> = msg_send![class!(NSLocale), preferredLanguages];
        let Some(langs) = langs else {
            return "en".into();
        };
        let first: Option<Retained<NSString>> = msg_send![&*langs, firstObject];
        first.map(|s| s.to_string()).unwrap_or_else(|| "en".into())
    }
}

type TerminateHandler = Box<dyn Fn() -> bool + Send + Sync>;
static TERMINATE_HANDLER: OnceLock<TerminateHandler> = OnceLock::new();

const NS_TERMINATE_CANCEL: NSUInteger = 0;
const NS_TERMINATE_NOW: NSUInteger = 1;

extern "C-unwind" fn application_should_terminate(
    _this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> NSUInteger {
    match TERMINATE_HANDLER.get() {
        Some(handler) if !handler() => NS_TERMINATE_CANCEL,
        _ => NS_TERMINATE_NOW,
    }
}

/// Routes system quit requests (Dock > Quit, logout, `osascript quit`) through
/// `handler`. The handler returns `true` to allow quitting right away, or
/// `false` to cancel and run the app's own unsaved-changes flow instead.
///
/// tao's app delegate does not implement `applicationShouldTerminate:`, so the
/// method is added to its class at runtime. If it already exists, nothing changes.
pub fn install_terminate_handler(handler: TerminateHandler) {
    if TERMINATE_HANDLER.set(handler).is_err() {
        return;
    }
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return;
        }
        let delegate: *mut AnyObject = msg_send![app, delegate];
        if delegate.is_null() {
            return;
        }
        let cls: *const AnyClass = (*delegate).class();
        let imp: Imp = std::mem::transmute(
            application_should_terminate
                as extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> NSUInteger,
        );
        // Return type NSUInteger (Q), self (@), _cmd (:), sender (@).
        let types = c"Q@:@";
        let _ = objc2::ffi::class_addMethod(
            cls as *mut AnyClass,
            sel!(applicationShouldTerminate:),
            imp,
            types.as_ptr(),
        );
    }
}

#[link(name = "PDFKit", kind = "framework")]
extern "C" {}

extern "C" {
    fn NSFullUserName() -> *mut NSString;
}

/// The user's full name from macOS, used as the default annotation author.
pub fn full_user_name() -> String {
    unsafe {
        let name = NSFullUserName();
        if name.is_null() {
            return String::new();
        }
        (*name).to_string()
    }
}

/// Prints a PDF with PDFKit and the standard macOS print panel.
/// Must run on the main thread; blocks until the panel is dismissed.
pub fn print_pdf(bytes: &[u8], job_title: &str) -> Result<(), String> {
    unsafe {
        let data = NSData::with_bytes(bytes);
        let allocated: *mut AnyObject = msg_send![class!(PDFDocument), alloc];
        let raw: *mut AnyObject = msg_send![allocated, initWithData: &*data];
        // initWithData: returns +1; Retained releases it when done.
        let doc = Retained::from_raw(raw).ok_or("PDFKit could not read this PDF")?;
        let info: *mut AnyObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
        // kPDFPrintPageScaleDownToFit = 2. The operation is autoreleased.
        let op: *mut AnyObject = msg_send![
            &*doc,
            printOperationForPrintInfo: info,
            scalingMode: 2isize,
            autoRotate: true
        ];
        if op.is_null() {
            return Err("could not create a print operation".into());
        }
        let title = NSString::from_str(job_title);
        let _: () = msg_send![op, setJobTitle: &*title];
        let _: bool = msg_send![op, runOperation];
    }
    Ok(())
}
