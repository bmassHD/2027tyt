import React from 'react';
import { Code2, Phone, Mail, Clock, ExternalLink, User, Info } from 'lucide-react';
import { SoftwareTeamContactConfig } from '../../types';

export function hasSoftwareTeamContactInfo(cfg?: SoftwareTeamContactConfig | null): boolean {
  if (!cfg || cfg.enabled === false) return false;
  return Boolean(
    cfg.teamName?.trim() ||
      cfg.personName?.trim() ||
      cfg.phone?.trim() ||
      cfg.email?.trim() ||
      cfg.zaloUrl?.trim() ||
      cfg.facebookUrl?.trim() ||
      cfg.websiteUrl?.trim() ||
      cfg.note?.trim()
  );
}

interface SoftwareTeamContactCardProps {
  contact?: SoftwareTeamContactConfig | null;
}

export const SoftwareTeamContactCard: React.FC<SoftwareTeamContactCardProps> = ({ contact }) => {
  if (!hasSoftwareTeamContactInfo(contact) || !contact) return null;

  const teamName = contact.teamName?.trim() || 'Đội ngũ Kỹ thuật & Phần mềm';
  const roleLabel = contact.roleLabel?.trim();
  const personName = contact.personName?.trim();
  const phone = contact.phone?.trim();
  const email = contact.email?.trim();
  const zaloUrl = contact.zaloUrl?.trim();
  const facebookUrl = contact.facebookUrl?.trim();
  const websiteUrl = contact.websiteUrl?.trim();
  const supportHours = contact.supportHours?.trim();
  const note = contact.note?.trim();

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-2xl bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 shrink-0">
            <Code2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
              Liên hệ Đội ngũ phần mềm &amp; Hỗ trợ kỹ thuật
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {roleLabel || 'Tiếp nhận phản hồi kỹ thuật, bảo trì & nâng cấp hệ thống'}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-3 text-xs sm:text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Đơn vị / Nhóm phát triển
            </span>
            <p className="font-bold text-slate-900 dark:text-white">{teamName}</p>
            {personName && (
              <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>Phụ trách: {personName}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            {phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-sky-600 shrink-0" />
                <a
                  href={`tel:${phone.replace(/\s+/g, '')}`}
                  className="font-bold text-slate-900 dark:text-white hover:text-sky-700 dark:hover:text-sky-400 hover:underline tabular-nums"
                >
                  {phone}
                </a>
              </div>
            )}
            {email && (
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-600 shrink-0" />
                <a
                  href={`mailto:${email}`}
                  className="font-semibold text-slate-800 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-400 hover:underline break-all"
                >
                  {email}
                </a>
              </div>
            )}
            {supportHours && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{supportHours}</span>
              </div>
            )}
          </div>
        </div>

        {note && (
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
            <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            <span>{note}</span>
          </div>
        )}

        {(zaloUrl || facebookUrl || websiteUrl) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {zaloUrl && (
              <a
                href={zaloUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 text-xs font-bold transition"
              >
                <span>Zalo hỗ trợ</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {facebookUrl && (
              <a
                href={facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 text-xs font-bold transition"
              >
                <span>Facebook</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold transition"
              >
                <span>Cổng hỗ trợ</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
